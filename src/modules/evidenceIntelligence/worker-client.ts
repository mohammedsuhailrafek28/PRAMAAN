// Client for the Python document-understanding worker (python/evidence_worker).
//
// The worker parses untrusted files, so it runs as a separate short-lived process:
//  * spawned with an argument vector (never a shell), a minimal environment, and its own temporary directory;
//  * handed an isolated copy of the file; the copy and its directory are removed in `finally`, success or not;
//  * limited by a wall-clock timeout (the process is killed), an output-size cap, and a concurrency/queue cap;
//  * its JSON is validated against a strict schema before anything uses it.
// Document content is never logged. A worker that is missing or fails to start yields `null` so the caller can fall back.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "../../utils/apiError.js";

export const WORKER_DEFAULTS = {
  timeoutMs: 120_000,
  maxStdoutBytes: 24 * 1024 * 1024,
  maxConcurrent: 2,
  maxQueued: 8,
  limits: { maxPages: 40, maxOcrPages: 12, maxPixels: 12_000_000, dpi: 200, timeBudgetSeconds: 100, maxMemoryMb: 1500 }
} as const;

const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const segment = z.object({ text: z.string().max(2_000), bbox, conf: z.number().min(0).max(1), method: z.string().max(40) });
const line = z.object({ text: z.string().max(4_000), bbox, column: z.number().int().min(0).max(8), segments: z.array(segment).max(60) });
const page = z.object({
  page: z.number().int().min(1).max(1_000),
  method: z.enum(["EMBEDDED_TEXT", "OCR", "MIXED", "NONE"]),
  width: z.number(),
  height: z.number(),
  columns: z.number().int().min(1).max(8),
  pdfRotation: z.number().int(),
  textQuality: z.object({ chars: z.number(), alnum: z.number(), garbledRatio: z.number(), words: z.number(), likeness: z.number().nullable().optional() }),
  ocr: z.object({ engine: z.string().nullable().optional(), meanConfidence: z.number().optional(), rotationDegrees: z.number().optional(), rotationsTried: z.array(z.number()).optional(), boxes: z.number().optional(), regions: z.number().optional(), dpi: z.number().nullable().optional() }).passthrough().nullable(),
  notes: z.array(z.string().max(80)).max(20),
  lines: z.array(line).max(1_500)
});
const tableRow = z.object({
  page: z.number().int(),
  date: z.string().nullable(),
  description: z.string().max(1_000),
  reference: z.string().max(200).nullable(),
  debit: z.number().nullable(),
  credit: z.number().nullable(),
  balance: z.number().nullable(),
  bbox,
  method: z.string().max(40),
  balanceCheck: z.enum(["PASSED", "FAILED", "NOT_APPLICABLE"]),
  confidence: z.number().min(0).max(1)
});
const table = z.object({
  kind: z.literal("BANK_TRANSACTIONS"),
  columns: z.array(z.string().max(40)).max(12),
  headerPages: z.array(z.number().int()).max(1_000),
  openingBalance: z.number().nullable(),
  rows: z.array(tableRow).max(2_000),
  rowCount: z.number().int(),
  balanceChecked: z.number().int(),
  balanceConsistent: z.number().int(),
  reliable: z.boolean()
});

export const workerOutputSchema = z.object({
  schema: z.literal(1),
  status: z.enum(["OK", "PARTIAL", "UNREADABLE", "UNSUPPORTED", "REJECTED"]),
  reason: z.string().max(60).nullable(),
  pageCount: z.number().int().min(0),
  processedPages: z.number().int().min(0),
  activeContent: z.array(z.string().max(40)).max(20),
  pages: z.array(page).max(100),
  tables: z.array(table).max(4),
  ocrPages: z.number().int().min(0),
  notes: z.array(z.string()).max(50),
  engine: z.object({ pymupdf: z.string().nullable().optional(), ocr: z.string().nullable().optional(), python: z.string().optional() }),
  metrics: z.object({ elapsedMs: z.number(), peakWorkingSetMb: z.number(), enforced: z.string() })
});

export type WorkerOutput = z.infer<typeof workerOutputSchema>;
export type WorkerKind = "pdf" | "png" | "jpeg";

export type WorkerRun = { output: WorkerOutput; wallMs: number };

const workerRoot = path.resolve(process.env.EVIDENCE_WORKER_DIR ?? path.join(process.cwd(), "python"));
const pythonExecutable = () => process.env.EVIDENCE_WORKER_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < WORKER_DEFAULTS.maxConcurrent) { active += 1; return; }
  if (waiting.length >= WORKER_DEFAULTS.maxQueued) throw new ApiError(503, "EXTRACTION_BUSY", "Document reading is busy. Please try again in a moment.");
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function release() {
  active -= 1;
  waiting.shift()?.();
}

function minimalEnvironment(tempDir: string): NodeJS.ProcessEnv {
  const keep = ["PATH", "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "WINDIR", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME", "LANG", "LC_ALL", "VIRTUAL_ENV", "PYTHONHOME"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1", OMP_NUM_THREADS: "2" };
}

export async function workerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(pythonExecutable(), ["-c", "import fitz"], { cwd: workerRoot, stdio: "ignore", shell: false, windowsHide: true });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/** Runs the worker on `bytes`. Resolves null when the worker cannot be started or returns invalid output. */
export async function runWorker(bytes: Buffer, kind: WorkerKind, options: { timeoutMs?: number } = {}): Promise<WorkerRun | null> {
  await acquire();
  const started = Date.now();
  let tempDir: string | null = null;
  try {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-extract-"));
    const input = path.join(tempDir, kind === "pdf" ? "input.pdf" : `input.${kind === "jpeg" ? "jpg" : "png"}`);
    await writeFile(input, bytes, { mode: 0o600 });
    const limits = WORKER_DEFAULTS.limits;
    const args = ["-m", "evidence_worker.worker", "--input", input, "--kind", kind, "--max-pages", String(limits.maxPages), "--max-ocr-pages", String(limits.maxOcrPages),
      "--max-pixels", String(limits.maxPixels), "--dpi", String(limits.dpi), "--time-budget", String(limits.timeBudgetSeconds), "--max-memory-mb", String(limits.maxMemoryMb)];
    return await new Promise<WorkerRun | null>((resolve) => {
      let settled = false;
      const finish = (value: WorkerRun | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      let child;
      try {
        child = spawn(pythonExecutable(), args, { cwd: workerRoot, env: minimalEnvironment(tempDir as string), stdio: ["ignore", "pipe", "ignore"], shell: false, windowsHide: true });
      } catch {
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(null); }, options.timeoutMs ?? WORKER_DEFAULTS.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > WORKER_DEFAULTS.maxStdoutBytes) { child.kill("SIGKILL"); finish(null); return; }
        chunks.push(chunk);
      });
      child.on("error", () => finish(null));
      child.on("close", () => {
        try {
          const parsed = workerOutputSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          finish(parsed.success ? { output: parsed.data, wallMs: Date.now() - started } : null);
        } catch {
          finish(null);
        }
      });
    });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    release();
  }
}
