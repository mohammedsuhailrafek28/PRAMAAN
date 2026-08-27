import { existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { sqlitePathFromDatabaseUrl } from "./reconcile-prisma-migrations.js";

const dbPath = sqlitePathFromDatabaseUrl();
const projectRoot = process.cwd().replace(/\\/g, "/");
const resolvedDb = dbPath.replace(/\\/g, "/");

if (!resolvedDb.startsWith(`${projectRoot}/`)) {
  throw new Error(`Refusing to reset a database outside the local project: ${dbPath}`);
}

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const target = `${dbPath}${suffix}`;
  if (existsSync(target)) rmSync(target, { force: true });
}

execSync("npm run db:init", { stdio: "inherit" });
execSync("npm run db:seed", { stdio: "inherit" });
console.log("Demo database reset complete. Seeded accounts use password123.");
