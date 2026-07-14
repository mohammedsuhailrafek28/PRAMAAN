import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const migrationOne = "202607130001_trust_os_foundation";
const migrationTwo = "202607140001_report_composer";
const migrationThree = "202607140002_report_rendering_audit_actions";
const migrationOneSql = readFileSync(path.join(root, "prisma", "migrations", migrationOne, "migration.sql"), "utf8");
const migrationTwoSql = readFileSync(path.join(root, "prisma", "migrations", migrationTwo, "migration.sql"), "utf8");

function dbUrl(dbPath: string) {
  const prismaDir = path.join(root, "prisma");
  const relative = path.relative(prismaDir, dbPath).replace(/\\/g, "/");
  return `file:./${relative}`;
}

function run(args: string[], databasePath: string, expectFailure = false) {
  try {
    const env = { ...process.env, DATABASE_URL: dbUrl(databasePath) };
    if (process.platform === "win32") {
      execFileSync("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], {
        cwd: root,
        env,
        stdio: "pipe"
      });
    } else {
      execFileSync("npm", args, {
        cwd: root,
        env,
        stdio: "pipe"
      });
    }
    if (expectFailure) throw new Error(`Expected npm ${args.join(" ")} to fail`);
  } catch (error) {
    if (!expectFailure) {
      const output = error && typeof error === "object" && "stdout" in error ? String((error as any).stdout) : "";
      const stderr = error && typeof error === "object" && "stderr" in error ? String((error as any).stderr) : "";
      throw new Error(`npm ${args.join(" ")} failed\n${output}\n${stderr}`);
    }
  }
}

function open(dbPath: string) {
  return new DatabaseSync(dbPath);
}

function tempDb(name: string) {
  const dir = path.join(root, "prisma", ".tmp-migration-tests", `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return { dir, dbPath: path.join(dir, "test.db") };
}

function appliedMigrations(dbPath: string) {
  const db = open(dbPath);
  try {
    return (
      db
        .prepare('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
        .all() as Array<{ migration_name: string }>
    ).map((row) => row.migration_name);
  } finally {
    db.close();
  }
}

function tableExists(dbPath: string, tableName: string) {
  const db = open(dbPath);
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
    return Boolean(row);
  } finally {
    db.close();
  }
}

function countSourceVerified(dbPath: string) {
  const db = open(dbPath);
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM Document WHERE evidenceStatus = 'SOURCE_VERIFIED'").get() as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

function createLegacyCore(dbPath: string) {
  const db = open(dbPath);
  try {
    db.exec(`
CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "role" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Business" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "legalName" TEXT,
  "gstin" TEXT UNIQUE,
  "udyamNumber" TEXT,
  "pan" TEXT,
  "address" TEXT,
  "turnoverBand" TEXT,
  "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Business_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "Document" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "docType" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "verifiedFlag" BOOLEAN NOT NULL DEFAULT false,
  "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Document_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "Passport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Passport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "ConsentRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requesterId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "requestedFields" JSONB NOT NULL,
  "approvedFields" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "durationDays" INTEGER,
  "approvedAt" DATETIME,
  "expiresAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "consentRequestId" TEXT,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "readFlag" BOOLEAN NOT NULL DEFAULT false,
  "relatedConsentId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "User" ("id", "role", "name", "organizationName", "email", "passwordHash") VALUES ('user_1', 'MSME', 'Ravi Sharma', 'Sharma Textiles', 'legacy@pramaan.demo', 'hash');
INSERT INTO "Business" ("id", "userId", "legalName", "gstin", "verificationStatus", "updatedAt") VALUES ('biz_1', 'user_1', 'Sharma Textiles', '33ABCDE1234F1Z5', 'VERIFIED', CURRENT_TIMESTAMP);
INSERT INTO "Document" ("id", "businessId", "docType", "filePath", "originalName", "mimeType", "verifiedFlag") VALUES ('doc_1', 'biz_1', 'GST_CERTIFICATE', 'uploads/legacy.pdf', 'legacy.pdf', 'application/pdf', true);
INSERT INTO "Passport" ("id", "businessId", "version", "snapshotJson") VALUES ('passport_1', 'biz_1', 1, '{}');
`);
  } finally {
    db.close();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function withDb(name: string, fn: (dbPath: string) => void) {
  const { dir, dbPath } = tempDb(name);
  try {
    fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  withDb("fresh", (dbPath) => {
    run(["run", "db:init"], dbPath);
    run(["run", "db:status"], dbPath);
    const applied = appliedMigrations(dbPath);
    assert(applied.includes(migrationOne), "fresh database did not track Trust OS migration");
    assert(applied.includes(migrationTwo), "fresh database did not track Report Composer migration");
    assert(applied.includes(migrationThree), "fresh database did not track Report Rendering migration");
    pass("fresh database initializes with tracked Prisma migrations");
  });

  withDb("legacy", (dbPath) => {
    createLegacyCore(dbPath);
    run(["run", "db:reconcile"], dbPath);
    run(["run", "db:status"], dbPath);
    assert(tableExists(dbPath, "ReadinessEvaluation"), "legacy database missing ReadinessEvaluation after reconcile");
    assert(tableExists(dbPath, "GeneratedReport"), "legacy database missing GeneratedReport after reconcile");
    assert(countSourceVerified(dbPath) === 0, "legacy verifiedFlag was promoted to SOURCE_VERIFIED");
    const applied = appliedMigrations(dbPath);
    assert(applied.includes(migrationOne) && applied.includes(migrationTwo) && applied.includes(migrationThree), "legacy database migrations not tracked");
    run(["run", "db:reconcile"], dbPath);
    pass("legacy untracked database reconciles idempotently without SOURCE_VERIFIED promotion");
  });

  withDb("partial", (dbPath) => {
    const db = open(dbPath);
    db.exec(migrationOneSql);
    db.close();
    run(["run", "db:reconcile"], dbPath);
    run(["run", "db:status"], dbPath);
    assert(tableExists(dbPath, "GeneratedReport"), "partial database did not apply report migration");
    const applied = appliedMigrations(dbPath);
    assert(applied.includes(migrationOne) && applied.includes(migrationTwo) && applied.includes(migrationThree), "partial database migrations not tracked");
    pass("partial database resolves Trust OS and applies missing report migration");
  });

  withDb("tracked", (dbPath) => {
    run(["run", "db:migrate"], dbPath);
    const before = appliedMigrations(dbPath).join(",");
    run(["run", "db:reconcile"], dbPath);
    run(["run", "db:status"], dbPath);
    const after = appliedMigrations(dbPath).join(",");
    assert(before === after, "tracked database migration records changed");
    pass("tracked database remains idempotent");
  });

  withDb("invalid", (dbPath) => {
    run(["run", "db:migrate"], dbPath);
    const db = open(dbPath);
    db.exec('DROP TABLE "GeneratedReport";');
    db.close();
    run(["run", "db:reconcile"], dbPath, true);
    pass("invalid tracked database fails safely when schema object is missing");
  });

  withDb("schema-complete-untracked", (dbPath) => {
    const db = open(dbPath);
    db.exec(migrationOneSql);
    db.exec(migrationTwoSql);
    db.close();
    run(["run", "db:reconcile"], dbPath);
    run(["run", "db:status"], dbPath);
    const applied = appliedMigrations(dbPath);
    assert(applied.includes(migrationOne) && applied.includes(migrationTwo) && applied.includes(migrationThree), "schema-complete database was not resolved");
    pass("schema-complete untracked database resolves both migrations");
  });
}

main();
