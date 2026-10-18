import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIN_PRODUCTION_JWT_SECRET_LENGTH, productionJwtSecretError } from "../src/config/jwtSecretPolicy.js";
import { sanitizeRequestLogPath } from "../src/utils/requestLogPath.js";

const root = process.cwd();
const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const requiredSecret = "JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set for the production container}";
const secretLine = compose.split(/\r?\n/).find((line) => line.trimStart().startsWith("JWT_SECRET:"));

assert.equal(secretLine?.trim(), requiredSecret, "Docker Compose must require an injected JWT_SECRET");
assert(secretLine?.includes("${JWT_SECRET:"), "Docker Compose must not contain a literal JWT secret");
console.log("PASS production Docker Compose requires JWT_SECRET and contains no literal secret");

assert(productionJwtSecretError(undefined)?.includes("explicitly configured"), "missing production JWT_SECRET was accepted");
assert(productionJwtSecretError("dev-secret-change-me"), "known development secret was accepted");
assert(productionJwtSecretError("A".repeat(MIN_PRODUCTION_JWT_SECRET_LENGTH)), "repetitive production secret was accepted");
assert(productionJwtSecretError("12345678901234567890123456789012"), "low-variety production secret was accepted");
assert.equal(productionJwtSecretError("A-long-random-test-secret-with-many-distinct-characters-123!"), undefined, "strong test secret was rejected");
console.log("PASS production JWT policy rejects missing, known-default, repetitive, short, and low-variety secrets");

const envProbe = path.join(root, "src", "config", "env.ts");
const runEnvProbe = (secret: string) => {
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), envProbe], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production", JWT_SECRET: secret },
      stdio: "ignore"
    });
    return undefined;
  } catch (error) {
    return error;
  }
};
assert(runEnvProbe("12345678901234567890123456789012"), "production startup accepted a weak JWT_SECRET");
assert.equal(runEnvProbe("A-long-random-test-secret-with-many-distinct-characters-123!"), undefined, "production startup rejected a strong test JWT_SECRET");
console.log("PASS production startup rejects weak JWT_SECRET and accepts a strong configured test value");

const token = "A".repeat(43);
const guestPath = `/api/public/verify/${token}`;
const sanitizedGuestPath = sanitizeRequestLogPath(guestPath);
assert(!sanitizedGuestPath.includes(token), "guest bearer token remained in the sanitized request path");
assert.equal(sanitizedGuestPath, "/api/public/verify/[redacted]", "guest path was not redacted consistently");
console.log("PASS guest bearer tokens are removed from request log paths");

const guestPathWithQuery = `${guestPath}?source=demo`;
assert.equal(sanitizeRequestLogPath(guestPathWithQuery), "/api/public/verify/[redacted]", "guest query string was not removed from the log path");

const encodedGuestPath = `/api/public/verify/${"%41".repeat(token.length)}?token=${encodeURIComponent(token)}`;
assert.equal(sanitizeRequestLogPath(encodedGuestPath), "/api/public/verify/[redacted]", "encoded guest token remained in the log path");

const encodedRoutePath = `/%61pi/%70ublic/%76erify/${token}`;
assert.equal(sanitizeRequestLogPath(encodedRoutePath), "/api/public/verify/[redacted]", "encoded guest route remained in the log path");

const malformedGuestPath = "/api/public/verify/%E0%A4%A?token=malformed-secret-value";
assert.equal(sanitizeRequestLogPath(malformedGuestPath), "/api/public/verify/[redacted]", "malformed guest path was not conservatively redacted");

const missingTokenPath = "/api/public/verify?token=possible-bearer-value";
assert.equal(sanitizeRequestLogPath(missingTokenPath), "/api/public/verify/[redacted]", "guest query token was not redacted");

const similarButDifferentPath = "/api/public/verify-not-a-route/" + token;
assert.equal(sanitizeRequestLogPath(similarButDifferentPath), similarButDifferentPath, "unrelated API path was unexpectedly changed");

const ordinaryPath = "/api/health?check=1";
assert.equal(sanitizeRequestLogPath(ordinaryPath), ordinaryPath, "ordinary request paths were unexpectedly changed");
console.log("PASS ordinary request paths remain unchanged");
