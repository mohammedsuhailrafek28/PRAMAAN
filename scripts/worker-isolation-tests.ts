// Verifies the worker container's isolation by running probes inside a container started with EXACTLY the flags the
// runtime uses (containerRunArgs). Needs Docker and the image (npm run worker:image). Exits 2 — never "pass" — when the
// sandbox cannot be exercised, so nobody can mistake an untested sandbox for a working one.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { containerRunArgs, dockerCliEnvironment, dockerExecutable, WORKER_IMAGE_DEFAULT } from "../src/modules/evidenceIntelligence/worker-container.js";
import { ExtractionAborted, runWorker } from "../src/modules/evidenceIntelligence/worker-client.js";
import { buildPdf, gstCertificate, makeGstin } from "./fixtures/synthetic-pdf.js";

let failures = 0;
const test = (name: string, callback: () => void | Promise<void>) =>
  Promise.resolve().then(callback).then(() => console.log(`PASS ${name}`), (error) => { failures += 1; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); });

const image = process.env.EVIDENCE_WORKER_IMAGE ?? WORKER_IMAGE_DEFAULT;
const docker = dockerExecutable();

function probe(code: string, options: { timeoutMs?: number } = {}) {
  const name = `pramaan-probe-${Math.random().toString(16).slice(2, 10)}`;
  // The CLI environment deliberately carries fake secrets: none of them may reach the container.
  const cli = { ...dockerCliEnvironment(), JWT_SECRET: "must-not-leak", DATABASE_URL: "file:must-not-leak", UPLOAD_DIR: "must-not-leak" };
  const result = spawnSync(docker, containerRunArgs({ name, entrypoint: "python", command: ["-c", code], interactive: false }), { env: cli, encoding: "utf8", timeout: options.timeoutMs ?? 60_000, windowsHide: true });
  return { status: result.status, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}
const json = (code: string) => JSON.parse(probe(code).out);

async function main() {
  try {
    execFileSync(docker, ["image", "inspect", image], { stdio: "ignore", env: dockerCliEnvironment() });
  } catch {
    console.error(`SKIPPED (not passed): Docker or image ${image} is unavailable. Build it with: npm run worker:image`);
    process.exit(2);
  }

  await test("runs as an unprivileged user (uid/gid 10001)", () => {
    assert.deepEqual(json("import os,json;print(json.dumps([os.getuid(),os.getgid()]))"), [10001, 10001]);
  });

  await test("no network: only loopback exists and outbound connections and DNS fail", () => {
    const r = json(`
import json, os, socket
ifaces = sorted(os.listdir('/sys/class/net'))
def attempt(fn):
    try: fn(); return 'connected'
    except Exception as e: return type(e).__name__
out = {'ifaces': ifaces,
       'tcp': attempt(lambda: socket.create_connection(('1.1.1.1', 53), 3)),
       'dns': attempt(lambda: socket.getaddrinfo('example.com', 443))}
print(json.dumps(out))`);
    assert.deepEqual(r.ifaces, ["lo"]);
    assert.notEqual(r.tcp, "connected");
    assert.notEqual(r.dns, "connected");
  });

  await test("root filesystem is read-only; /tmp is writable but not executable", () => {
    const r = json(`
import json, os, shutil, subprocess
def attempt(fn):
    try: fn(); return 'ok'
    except Exception as e: return type(e).__name__
def write(path):
    open(path, 'w').write('x')
def run_from_tmp():
    shutil.copy('/bin/true', '/tmp/true'); os.chmod('/tmp/true', 0o755); subprocess.run(['/tmp/true'], check=True)
print(json.dumps({'root': attempt(lambda: write('/usr/probe')), 'app': attempt(lambda: write('/app/probe')), 'tmp': attempt(lambda: write('/tmp/probe')), 'tmp_exec': attempt(run_from_tmp)}))`);
    assert.notEqual(r.root, "ok");
    assert.notEqual(r.app, "ok");
    assert.equal(r.tmp, "ok");
    assert.notEqual(r.tmp_exec, "ok");
  });

  await test("all Linux capabilities are dropped and privilege escalation is blocked", () => {
    const status = probe("print(open('/proc/self/status').read())").out;
    assert.match(status, /CapEff:\s*0000000000000000/);
    assert.match(status, /CapBnd:\s*0000000000000000/);
    assert.match(status, /NoNewPrivs:\s*1/);
    assert.match(status, /Seccomp:\s*2/, "a seccomp filter is active");
  });

  await test("no secrets or host environment reach the container", () => {
    const keys = json("import os,json;print(json.dumps(sorted(os.environ)))") as string[];
    assert.ok(!keys.some((key) => /SECRET|TOKEN|PASSWORD|DATABASE|JWT|UPLOAD|API_KEY/i.test(key)), `unexpected variables: ${keys.join(",")}`);
    assert.ok(!probe("import os;print(os.environ.get('JWT_SECRET',''))").out.includes("must-not-leak"));
  });

  await test("no Docker socket or host mounts are visible", () => {
    const r = json(`
import json, os
mounts = open('/proc/self/mountinfo').read()
print(json.dumps({'socket': os.path.exists('/var/run/docker.sock'), 'host_users': os.path.exists('/mnt/c') or os.path.exists('/host'), 'bind_from_host': 'C:' in mounts or '/Users' in mounts}))`);
    assert.equal(r.socket, false);
    assert.equal(r.host_users, false);
  });

  await test("process count is limited (fork bomb is contained)", () => {
    const r = json(`
import json, os, time
kids = []
try:
    for _ in range(300):
        pid = os.fork()
        if pid == 0:
            time.sleep(5); os._exit(0)
        kids.append(pid)
    result = 'unbounded'
except OSError as e:
    result = 'limited'
for pid in kids:
    os.kill(pid, 9)
print(json.dumps({'forked': len(kids), 'result': result}))`);
    assert.equal(r.result, "limited");
    assert.ok(r.forked < 100, `forked ${r.forked}`);
  });

  await test("memory is capped: a 2.6 GB allocation is killed by the container limit", () => {
    const r = probe("b = bytearray(2600 * 1024 * 1024)\nfor i in range(0, len(b), 4096): b[i] = 1\nprint('survived')", { timeoutMs: 120_000 });
    assert.notEqual(r.out, "survived");
    assert.notEqual(r.status, 0);
  });

  await test("the real worker reads a document through the container (file on stdin, JSON on stdout)", async () => {
    process.env.EVIDENCE_WORKER_MODE = "container";
    const gstin = makeGstin("27", "ABCDE1234F");
    const bytes = buildPdf(gstCertificate({ gstin, legalName: "Sunrise Textiles Private Limited", pan: "ABCDE1234F" }));
    const run = await runWorker(bytes, "pdf");
    assert.ok(run, "worker returned a result");
    assert.equal(run.isolation, "CONTAINER");
    assert.equal(run.output.status, "OK");
    assert.ok(run.output.pages[0].lines.some((line) => line.text.includes(gstin)));
    const mixed = await runWorker(Buffer.from("MZ not a pdf"), "pdf");
    assert.equal(mixed?.output.status, "UNSUPPORTED");
  });

  await test("an aborted extraction removes its container and leaves nothing behind", async () => {
    process.env.EVIDENCE_WORKER_MODE = "container";
    const controller = new AbortController();
    const bytes = buildPdf(gstCertificate({ gstin: makeGstin("27", "ABCDE1234F"), legalName: "Sunrise Textiles Private Limited", pan: "ABCDE1234F" }));
    const pending = runWorker(bytes, "pdf", { signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(pending, (error) => error instanceof ExtractionAborted);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const left = execFileSync(docker, ["ps", "-a", "--filter", "name=pramaan-xw-", "--format", "{{.Names}}"], { encoding: "utf8", env: dockerCliEnvironment() }).trim();
    assert.equal(left, "", "no worker container is left running or stopped");
  });

  await test("a missing Docker image fails closed instead of falling back to in-process parsing", async () => {
    process.env.EVIDENCE_WORKER_MODE = "container";
    const saved = process.env.EVIDENCE_WORKER_IMAGE;
    process.env.EVIDENCE_WORKER_IMAGE = "pramaan-evidence-worker:does-not-exist";
    try {
      const { extractDocumentHybrid } = await import("../src/modules/evidenceIntelligence/hybrid-extractor.js");
      const result = await extractDocumentHybrid({ documentId: "x", docType: "GST_CERTIFICATE", mimeType: "application/pdf", bytes: buildPdf(gstCertificate({ gstin: makeGstin("27", "ABCDE1234F"), legalName: "A B Private Limited", pan: "ABCDE1234F" })) });
      assert.equal(result.status, "UNREADABLE");
      assert.equal(result.reason, "WORKER_UNAVAILABLE");
      assert.equal(result.engine, "HYBRID");
    } finally {
      if (saved === undefined) delete process.env.EVIDENCE_WORKER_IMAGE; else process.env.EVIDENCE_WORKER_IMAGE = saved;
    }
  });

  if (failures > 0) { console.error(`\n${failures} isolation test(s) failed`); process.exit(1); }
  console.log("\nAll worker isolation tests passed (container mode actually exercised)");
}

main().catch((error) => { console.error(error); process.exit(1); });
