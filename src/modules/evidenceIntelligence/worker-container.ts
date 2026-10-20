// How the extraction worker is run inside a container. Single source of truth for the isolation flags: the runtime
// (worker-client.ts) and the isolation test (scripts/worker-isolation-tests.ts) both build their `docker run` from here, so
// the test exercises exactly what production runs.
//
// Hand-off is explicit and minimal: the file goes in on STDIN, the JSON result comes out on STDOUT, and the container is
// removed (--rm) when it exits. No volume or bind mount, no environment variable, no network, no capability.
//
// Established guidance followed: OWASP Docker Security Cheat Sheet (non-root user, --cap-drop all, no-new-privileges,
// --read-only with a tmpfs, memory/CPU/pids/ulimit limits, default seccomp profile, never --privileged, never mount the
// Docker socket) and the pattern used by Dangerzone (untrusted documents are processed inside a disposable container with
// no network and only the processed output leaves it).

export const WORKER_IMAGE_DEFAULT = "pramaan-evidence-worker:local";

export type ContainerLimits = { memoryMb: number; cpus: number; pids: number; tmpfsMb: number };
export const CONTAINER_LIMITS: ContainerLimits = { memoryMb: 1800, cpus: Number(process.env.EVIDENCE_WORKER_CPUS ?? 4), pids: 64, tmpfsMb: 256 };

/** Arguments after `docker` for a one-shot worker container. `command` is appended after the image (worker flags or a probe). */
export function containerRunArgs(options: { name: string; image?: string; limits?: ContainerLimits; entrypoint?: string; command: string[]; interactive?: boolean }): string[] {
  const limits = options.limits ?? CONTAINER_LIMITS;
  return [
    "run", "--rm", ...(options.interactive === false ? [] : ["-i"]),
    "--name", options.name,
    "--network", "none",
    "--read-only",
    "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=${limits.tmpfsMb}m`,
    "--user", "10001:10001",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", String(limits.pids),
    "--memory", `${limits.memoryMb}m`, "--memory-swap", `${limits.memoryMb}m`,
    "--cpus", String(limits.cpus),
    "--ulimit", "nofile=256:256", "--ulimit", "nproc=64:64", "--ulimit", "core=0",
    // The daemon's default json-file log driver would persist stdout (which carries extracted text) on the host.
    "--log-driver", "none",
    ...(options.entrypoint ? ["--entrypoint", options.entrypoint] : []),
    options.image ?? process.env.EVIDENCE_WORKER_IMAGE ?? WORKER_IMAGE_DEFAULT,
    ...options.command
  ];
}

export const dockerExecutable = () => process.env.EVIDENCE_WORKER_DOCKER ?? "docker";

/** Environment for the docker CLI process only (never forwarded into the container, which receives no `-e` at all). */
export function dockerCliEnvironment(): NodeJS.ProcessEnv {
  const keep = ["PATH", "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "WINDIR", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}
