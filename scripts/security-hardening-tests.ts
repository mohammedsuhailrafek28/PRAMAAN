import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sanitizeRequestLogPath } from "../src/utils/requestLogPath.js";

const root = process.cwd();
const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const requiredSecret = "JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set for the production container}";
const secretLine = compose.split(/\r?\n/).find((line) => line.trimStart().startsWith("JWT_SECRET:"));

assert.equal(secretLine?.trim(), requiredSecret, "Docker Compose must require an injected JWT_SECRET");
assert(secretLine?.includes("${JWT_SECRET:"), "Docker Compose must not contain a literal JWT secret");
console.log("PASS production Docker Compose requires JWT_SECRET and contains no literal secret");

const token = "A".repeat(43);
const guestPath = `/api/public/verify/${token}`;
const sanitizedGuestPath = sanitizeRequestLogPath(guestPath);
assert(!sanitizedGuestPath.includes(token), "guest bearer token remained in the sanitized request path");
assert.equal(sanitizedGuestPath, "/api/public/verify/[redacted]", "guest path was not redacted consistently");
console.log("PASS guest bearer tokens are removed from request log paths");

const guestPathWithQuery = `${guestPath}?source=demo`;
assert(!sanitizeRequestLogPath(guestPathWithQuery).includes(token), "guest bearer token remained before a query string");

const ordinaryPath = "/api/health?check=1";
assert.equal(sanitizeRequestLogPath(ordinaryPath), ordinaryPath, "ordinary request paths were unexpectedly changed");
console.log("PASS ordinary request paths remain unchanged");
