// Client for the Python document-understanding worker (python/evidence_worker).
//
// The worker parses untrusted files, so it runs as a separate short-lived process:
//  * spawned with an argument vector (never a shell), a minimal environment, and its own temporary directory;
//  * handed an isolated copy of the file; the copy and its directory are removed in `finally`, success or not;
//  * limited by a wall-clock timeout (the process is killed), an output-size cap, and a concurrency/queue cap;
//  * its JSON is validated against a strict schema before anything uses it.
// Two isolation modes (EVIDENCE_WORKER_MODE): "container" runs the worker in a locked-down one-shot Docker container (see
// worker-container.ts; file on stdin, JSON on stdout, no network/volumes/env) and "local" runs it as a bounded child process.
// LOCAL IS LESS ISOLATED and is meant for development; production defaults to container and never silently downgrades.
// Document content is never logged. A worker that is missing or fails to start yields `null` so the caller can decide.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "../../utils/apiError.js";
import { containerRunArgs, dockerCliEnvironment, dockerExecutable } from "./worker-container.js";

const CONTAINER_TIME_BUDGET_SECONDS = 170;
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

export type WorkerIsolation = "CONTAINER" | "LOCAL_PROCESS";
export type WorkerRun = { output: WorkerOutput; wallMs: number; isolation: WorkerIsolation };

/** Thrown when the caller aborts an extraction (job cancelled); never treated as a worker failure. */
export class ExtractionAborted extends Error {
  constructor() { super("EXTRACTION_ABORTED"); }
}

export function workerMode(): "container" | "local" {
  const configured = process.env.EVIDENCE_WORKER_MODE;
  if (configured === "container" || configured === "local") return configured;
  return process.env.NODE_ENV === "production" ? "container" : "local";
}
export const workerIsolation = (): WorkerIsolation => (workerMode() === "container" ? "CONTAINER" : "LOCAL_PROCESS");

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
  // EVIDENCE_PDF_BACKEND selects the (experimental) PDF library; it is configuration, not a secret.
  const backend = process.env.EVIDENCE_PDF_BACKEND ? { EVIDENCE_PDF_BACKEND: process.env.EVIDENCE_PDF_BACKEND } : {};
  return { ...env, ...backend, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1", OMP_NUM_THREADS: "2" };
}

function workerFlags(kind: WorkerKind): string[] {
  // Containerised OCR measured ~2.5x slower than a local process on Docker Desktop (mixed 3-page statement: ~60 s vs ~23 s),
  // so it gets a larger cooperative budget; the hard wall-clock kill is raised to match (see timeoutFor).
  const limits = { ...WORKER_DEFAULTS.limits, timeBudgetSeconds: workerMode() === "container" ? CONTAINER_TIME_BUDGET_SECONDS : WORKER_DEFAULTS.limits.timeBudgetSeconds };
  return ["--kind", kind, "--max-pages", String(limits.maxPages), "--max-ocr-pages", String(limits.maxOcrPages), "--max-pixels", String(limits.maxPixels), "--dpi", String(limits.dpi),
    "--time-budget", String(limits.timeBudgetSeconds), "--max-memory-mb", String(limits.maxMemoryMb)];
}

/** True when the configured isolation mode can run a worker right now (container mode: docker reachable and the image present). */
export async function workerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = workerMode() === "container"
        ? spawn(dockerExecutable(), ["image", "inspect", process.env.EVIDENCE_WORKER_IMAGE ?? "pramaan-evidence-worker:local"], { stdio: "ignore", shell: false, windowsHide: true, env: dockerCliEnvironment() })
        : spawn(pythonExecutable(), ["-c", "import fitz"], { cwd: workerRoot, stdio: "ignore", shell: false, windowsHide: true });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

type Execution = { command: string; args: string[]; options: Parameters<typeof spawn>[2]; stdin?: Buffer; onKill?: () => void };

/** Runs one prepared child with timeout, abort, output cap and schema validation. Resolves null on any failure. */
function execute(spec: Execution, timeoutMs: number, signal: AbortSignal | undefined, isolation: WorkerIsolation, started: number): Promise<WorkerRun | null> {
  return new Promise<WorkerRun | null>((resolve) => {
    let settled = false;
    let child: ReturnType<typeof spawn>;
    const kill = () => { try { spec.onKill?.(); child?.kill("SIGKILL"); } catch { /* already gone */ } };
    const finish = (value: WorkerRun | null) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(value); } };
    const onAbort = () => { kill(); finish(null); };
    const timer = setTimeout(() => { kill(); finish(null); }, timeoutMs);
    try {
      child = spawn(spec.command, spec.args, { ...spec.options, shell: false, windowsHide: true, stdio: [spec.stdin ? "pipe" : "ignore", "pipe", "ignore"] });
    } catch {
      finish(null);
      return;
    }
    if (signal) { if (signal.aborted) { onAbort(); return; } signal.addEventListener("abort", onAbort, { once: true }); }
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > WORKER_DEFAULTS.maxStdoutBytes) { kill(); finish(null); return; }
      chunks.push(chunk);
    });
    child.on("error", () => finish(null));
    child.on("close", () => {
      try {
        const parsed = workerOutputSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        finish(parsed.success ? { output: parsed.data, wallMs: Date.now() - started, isolation } : null);
      } catch {
        finish(null);
      }
    });
    if (spec.stdin && child.stdin) {
      child.stdin.on("error", () => undefined); // the worker may exit before reading everything (e.g. oversize); not an error here
      child.stdin.end(spec.stdin);
    }
  });
}

/**
 * Runs the worker on `bytes`. Resolves null when the worker cannot be started or returns invalid output; throws
 * ExtractionAborted when `signal` was aborted by the caller.
 */
export async function runWorker(bytes: Buffer, kind: WorkerKind, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<WorkerRun | null> {
  if (options.signal?.aborted) throw new ExtractionAborted();
  await acquire();
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? (workerMode() === "container" ? 210_000 : WORKER_DEFAULTS.timeoutMs);
  let tempDir: string | null = null;
  try {
    let result: WorkerRun | null;
    if (workerMode() === "container") {
      const name = `pramaan-xw-${randomBytes(8).toString("hex")}`;
      const args = containerRunArgs({ name, command: [...workerFlags(kind), "--stdin"] });
      const kill = () => { try { spawn(dockerExecutable(), ["rm", "-f", name], { stdio: "ignore", shell: false, windowsHide: true, env: dockerCliEnvironment() }).on("error", () => undefined); } catch { /* best effort */ } };
      result = await execute({ command: dockerExecutable(), args, options: { env: dockerCliEnvironment() }, stdin: bytes, onKill: kill }, timeoutMs, options.signal, "CONTAINER", started);
      if (!result) kill(); // also removes a container whose CLI exited early
    } else {
      tempDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-extract-"));
      const input = path.join(tempDir, kind === "pdf" ? "input.pdf" : `input.${kind === "jpeg" ? "jpg" : "png"}`);
      await writeFile(input, bytes, { mode: 0o600 });
      result = await execute({ command: pythonExecutable(), args: ["-m", "evidence_worker.worker", "--input", input, ...workerFlags(kind)], options: { cwd: workerRoot, env: minimalEnvironment(tempDir) } }, timeoutMs, options.signal, "LOCAL_PROCESS", started);
    }
    if (options.signal?.aborted) throw new ExtractionAborted();
    return result;
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    release();
  }
}

/**
 * Removes work directories orphaned by a hard-killed API process (the `finally` that normally removes them never ran).
 * Only directories this module created (prefix) and older than `olderThanMs` are touched, so a live extraction is never affected.
 */
export async function sweepStaleWorkDirs(olderThanMs = 15 * 60_000): Promise<number> {
  let removed = 0;
  for (const name of await readdir(os.tmpdir()).catch(() => [] as string[])) {
    if (!name.startsWith("pramaan-extract-")) continue;
    const target = path.join(os.tmpdir(), name);
    try {
      if (Date.now() - (await stat(target)).mtimeMs < olderThanMs) continue;
      await rm(target, { recursive: true, force: true, maxRetries: 3 });
      removed += 1;
    } catch { /* best effort */ }
  }
  return removed;
}
