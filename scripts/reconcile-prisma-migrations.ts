import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";

type Column = { name: string; type: string; notnull: number; dflt_value: unknown };
type IndexRow = { name: string };
type MigrationRow = { migration_name: string; checksum: string | null; finished_at: string | null; rolled_back_at: string | null };

const root = process.cwd();

const migrations = [
  {
    name: "202607130001_trust_os_foundation",
    file: path.join(root, "prisma", "migrations", "202607130001_trust_os_foundation", "migration.sql"),
    tables: ["User", "Business", "Document", "Passport", "ConsentRequest", "AuditLog", "Notification", "ReadinessEvaluation"],
    columns: {
      Business: [
        "id",
        "userId",
        "legalName",
        "gstin",
        "udyamNumber",
        "pan",
        "address",
        "turnoverBand",
        "verificationStatus",
        "trustStatus",
        "trustSummary",
        "lastCrossCheckedAt",
        "createdAt",
        "updatedAt"
      ],
      Document: [
        "id",
        "businessId",
        "docType",
        "filePath",
        "originalName",
        "mimeType",
        "verifiedFlag",
        "evidenceStatus",
        "confidence",
        "confidenceReason",
        "crossCheckMethod",
        "source",
        "checkedAt",
        "expiresAt",
        "contradictionDetails",
        "uploadedAt"
      ],
      ReadinessEvaluation: ["id", "businessId", "profileId", "profileVersion", "score", "level", "blocked", "summaryJson", "evaluatedAt"]
    },
    indexes: ["User_email_key", "Business_userId_key", "Business_gstin_key", "Passport_businessId_version_key"]
  },
  {
    name: "202607140001_report_composer",
    file: path.join(root, "prisma", "migrations", "202607140001_report_composer", "migration.sql"),
    tables: ["GeneratedReport"],
    columns: {
      GeneratedReport: [
        "id",
        "businessId",
        "reportType",
        "reportVersion",
        "trustProfileId",
        "readinessEvaluationId",
        "snapshotJson",
        "generatedAt",
        "expiresAt",
        "revokedAt",
        "createdByUserId"
      ]
    },
    indexes: ["GeneratedReport_businessId_generatedAt_idx", "GeneratedReport_reportType_idx", "GeneratedReport_readinessEvaluationId_idx"]
  },
  {
    name: "202607140002_report_rendering_audit_actions",
    file: path.join(root, "prisma", "migrations", "202607140002_report_rendering_audit_actions", "migration.sql"),
    tables: [],
    columns: {},
    indexes: []
  },
  {
    name: "20260827120829_evidence_lifecycle",
    file: path.join(root, "prisma", "migrations", "20260827120829_evidence_lifecycle", "migration.sql"),
    tables: [],
    columns: {
      Document: ["issuedAt", "revision", "isCurrent", "previousVersionId"]
    },
    indexes: ["Document_businessId_docType_isCurrent_idx", "Document_previousVersionId_idx"]
  },
  {
    name: "20260827130141_external_access_grants",
    file: path.join(root, "prisma", "migrations", "20260827130141_external_access_grants", "migration.sql"),
    tables: ["AccessGrant"],
    columns: { AccessGrant: ["id", "businessId", "createdByUserId", "requesterId", "recipientName", "recipientOrganization", "recipientEmail", "purpose", "scopeJson", "tokenHash", "status", "createdAt", "expiresAt", "revokedAt", "lastAccessedAt"] },
    indexes: ["AccessGrant_tokenHash_key", "AccessGrant_businessId_createdAt_idx", "AccessGrant_status_expiresAt_idx"]
  },
  {
    name: "20260827135225_consent_request_purpose",
    file: path.join(root, "prisma", "migrations", "20260827135225_consent_request_purpose", "migration.sql"),
    tables: [],
    columns: { ConsentRequest: ["purpose"] },
    indexes: []
  },
  {
    name: "202610010001_finals_disclosure_hardening",
    file: path.join(root, "prisma", "migrations", "202610010001_finals_disclosure_hardening", "migration.sql"),
    tables: [],
    columns: { ConsentRequest: ["requestedEvidenceTypes", "approvedEvidenceTypes", "approvedPassportId"], AccessGrant: ["passportId"] },
    indexes: ["ConsentRequest_approvedPassportId_idx", "AccessGrant_passportId_idx"]
  },
  {
    name: "202610170001_identity_assurance",
    file: path.join(root, "prisma", "migrations", "202610170001_identity_assurance", "migration.sql"),
    tables: ["RequesterAssurance", "RequesterAssuranceEvent"],
    columns: {
      RequesterAssurance: ["id", "userId", "status", "reviewedOrganizationName", "reviewBasis", "reviewedAt", "reviewerIdentifier", "authorizationBasis", "authorizationReference", "authorizationScope", "authorizationExpiresAt", "suspensionReason", "suspendedAt", "createdAt", "updatedAt"],
      RequesterAssuranceEvent: ["id", "userId", "operatorId", "action", "previousStatus", "newStatus", "metadata", "createdAt"]
    },
    indexes: ["RequesterAssurance_userId_key", "RequesterAssurance_status_authorizationExpiresAt_idx", "RequesterAssuranceEvent_userId_createdAt_idx"]
  }
] as const;

const coreTables = ["User", "Business", "Document", "Passport", "ConsentRequest", "AuditLog", "Notification"];

export function sqlitePathFromDatabaseUrl(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl?.startsWith("file:")) {
    return path.resolve("prisma", "dev.db");
  }

  const rawPath = databaseUrl.slice("file:".length).replace(/^"|"$/g, "");
  return path.isAbsolute(rawPath) ? rawPath : path.resolve("prisma", rawPath);
}

function openDatabase(dbPath: string) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  return new DatabaseSync(dbPath);
}

function tableNames(db: DatabaseSync) {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function indexNames(db: DatabaseSync) {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as IndexRow[]
  ).map((row) => row.name);
}

function columns(db: DatabaseSync, tableName: string) {
  return db.prepare(`PRAGMA table_info("${tableName}")`).all() as Column[];
}

function migrationRows(db: DatabaseSync) {
  if (!tableNames(db).includes("_prisma_migrations")) return [] as MigrationRow[];
  return db
    .prepare('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"')
    .all() as MigrationRow[];
}

function appliedMigrationNames(db: DatabaseSync) {
  return migrationRows(db)
    .filter((row) => row.finished_at && !row.rolled_back_at)
    .map((row) => row.migration_name);
}

function hasAll(values: string[], expected: readonly string[]) {
  return expected.every((value) => values.includes(value));
}

function verifyMigrationShape(db: DatabaseSync, migration: (typeof migrations)[number]) {
  const tables = tableNames(db);
  const indexes = indexNames(db);
  if (!hasAll(tables, migration.tables)) return false;
  if (!hasAll(indexes, migration.indexes)) return false;

  for (const [tableName, expectedColumns] of Object.entries(migration.columns)) {
    const present = columns(db, tableName).map((column) => column.name);
    if (!hasAll(present, expectedColumns)) return false;
  }

  return true;
}

function legacyCoreSchemaPresent(db: DatabaseSync) {
  const tables = tableNames(db);
  return hasAll(tables, coreTables);
}

function hasSourceVerifiedPromotion(db: DatabaseSync) {
  if (!tableNames(db).includes("Document")) return false;
  const present = columns(db, "Document").map((column) => column.name);
  if (!present.includes("evidenceStatus")) return false;
  const row = db.prepare("SELECT COUNT(*) AS count FROM Document WHERE evidenceStatus = 'SOURCE_VERIFIED'").get() as { count: number };
  return row.count > 0;
}

function checksum(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function createBackup(dbPath: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.backup-${timestamp}`;
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

function ensureColumn(db: DatabaseSync, tableName: string, columnName: string, definition: string) {
  const present = columns(db, tableName).some((column) => column.name === columnName);
  if (!present) {
    db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition};`);
  }
}

function mutateKnownLegacySchema(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    ensureColumn(db, "Business", "trustStatus", "TEXT NOT NULL DEFAULT 'SELF_DECLARED'");
    ensureColumn(db, "Business", "trustSummary", "JSONB");
    ensureColumn(db, "Business", "lastCrossCheckedAt", "DATETIME");
    ensureColumn(db, "Document", "evidenceStatus", "TEXT NOT NULL DEFAULT 'DOCUMENT_SUBMITTED'");
    ensureColumn(db, "Document", "confidence", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "Document", "confidenceReason", "TEXT");
    ensureColumn(db, "Document", "crossCheckMethod", "TEXT");
    ensureColumn(db, "Document", "source", "TEXT");
    ensureColumn(db, "Document", "checkedAt", "DATETIME");
    ensureColumn(db, "Document", "expiresAt", "DATETIME");
    ensureColumn(db, "Document", "contradictionDetails", "JSONB");
    db.exec(`
CREATE TABLE IF NOT EXISTS "ReadinessEvaluation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "profileVersion" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "level" TEXT NOT NULL,
  "blocked" BOOLEAN NOT NULL,
  "summaryJson" JSONB NOT NULL,
  "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReadinessEvaluation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "Business_userId_key" ON "Business"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Business_gstin_key" ON "Business"("gstin");
CREATE UNIQUE INDEX IF NOT EXISTS "Passport_businessId_version_key" ON "Passport"("businessId", "version");
`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function runPrisma(args: string[]) {
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", `npx prisma ${args.join(" ")}`], {
      cwd: root,
      env: process.env,
      stdio: "inherit"
    });
    return;
  }

  execFileSync(npmBinary("npx"), ["prisma", ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
}

function resolveApplied(migrationName: string) {
  runPrisma(["migrate", "resolve", "--applied", migrationName]);
}

function prismaDeploy() {
  runPrisma(["migrate", "deploy"]);
}

function prismaStatus() {
  runPrisma(["migrate", "status"]);
}

function npmBinary(name: string) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

export function reconcilePrismaMigrations(options: { deploy?: boolean; status?: boolean } = {}) {
  const dbPath = sqlitePathFromDatabaseUrl();
  const dbExists = existsSync(dbPath);
  const db = openDatabase(dbPath);
  const report: string[] = [];
  let backupPath: string | undefined;

  try {
    db.exec("PRAGMA foreign_keys = ON");
    const tables = tableNames(db).filter((name) => !name.startsWith("sqlite_"));
    const appTables = tables.filter((name) => name !== "_prisma_migrations");
    const applied = appliedMigrationNames(db);
    const trustComplete = verifyMigrationShape(db, migrations[0]);
    const reportComplete = verifyMigrationShape(db, migrations[1]);
    const evidenceComplete = verifyMigrationShape(db, migrations[3]);
    const accessComplete = verifyMigrationShape(db, migrations[4]);
    const purposeComplete = verifyMigrationShape(db, migrations[5]);
    const assuranceComplete = verifyMigrationShape(db, migrations[6]);
    const trustApplied = applied.includes(migrations[0].name);
    const reportApplied = applied.includes(migrations[1].name);
    const evidenceApplied = applied.includes(migrations[3].name);
    const accessApplied = applied.includes(migrations[4].name);
    const purposeApplied = applied.includes(migrations[5].name);
    const assuranceApplied = applied.includes(migrations[6].name);

    report.push(`Database: ${dbPath}`);
    report.push(`Datasource: sqlite`);
    report.push(`Migration fingerprints: ${migrations.map((migration) => `${migration.name}:${checksum(migration.file)}`).join(", ")}`);

    for (const migration of migrations) {
      const tracked = migrationRows(db).find((row) => row.migration_name === migration.name);
      const expectedChecksum = checksum(migration.file);
      if (tracked?.checksum && tracked.checksum !== expectedChecksum) {
        throw new Error(`${migration.name} is tracked with checksum ${tracked.checksum}, but the checked-in migration file is ${expectedChecksum}.`);
      }
    }

    if (trustApplied && !trustComplete) {
      throw new Error(`${migrations[0].name} is recorded as applied, but its schema objects are missing or incomplete.`);
    }
    if (reportApplied && !reportComplete) {
      throw new Error(`${migrations[1].name} is recorded as applied, but its schema objects are missing or incomplete.`);
    }
    if (evidenceApplied && !evidenceComplete) {
      throw new Error(`${migrations[3].name} is recorded as applied, but its schema objects are missing or incomplete.`);
    }
    if (accessApplied && !accessComplete) {
      throw new Error(`${migrations[4].name} is recorded as applied, but its schema objects are missing or incomplete.`);
    }
    if (purposeApplied && !purposeComplete) {
      throw new Error(`${migrations[5].name} is recorded as applied, but its schema objects are missing or incomplete.`);
    }
    if (assuranceApplied && !assuranceComplete) {
      throw new Error(`${migrations[6].name} is recorded as applied, but its schema objects are missing or incomplete.`);
    }
    if (hasSourceVerifiedPromotion(db)) {
      throw new Error("Existing Document rows contain SOURCE_VERIFIED. Reconciliation will not bless unverifiable evidence state.");
    }

    if (!dbExists || appTables.length === 0) {
      report.push("State: fresh/empty database");
      db.close();
      if (options.deploy ?? true) prismaDeploy();
      if (options.status) prismaStatus();
      console.log(report.join("\n"));
      return { state: "fresh", backupPath };
    }

    if (trustApplied && reportApplied && evidenceApplied && accessApplied && purposeApplied && assuranceApplied && trustComplete && reportComplete && evidenceComplete && accessComplete && purposeComplete && assuranceComplete) {
      report.push("State: fully migrated and tracked");
      db.close();
      if (options.deploy ?? true) prismaDeploy();
      if (options.status) prismaStatus();
      console.log(report.join("\n"));
      return { state: "tracked", backupPath };
    }

    if (!trustComplete && legacyCoreSchemaPresent(db) && !trustApplied) {
      backupPath = createBackup(dbPath);
      report.push(`State: known legacy SQLite schema`);
      report.push(`Backup: ${backupPath}`);
      mutateKnownLegacySchema(db);
    } else if (!trustComplete) {
      throw new Error("Database schema is incompatible or only partially matches the Trust OS baseline. No changes were made.");
    }

    const trustCompleteAfterUpgrade = verifyMigrationShape(db, migrations[0]);
    if (!trustCompleteAfterUpgrade) {
      throw new Error("Trust OS baseline schema is still incomplete after legacy upgrade. No migration history was reconciled.");
    }

    if (!trustApplied) {
      report.push(`Resolve applied: ${migrations[0].name}`);
      db.close();
      resolveApplied(migrations[0].name);
    } else {
      db.close();
    }

    const dbAfterTrust = openDatabase(dbPath);
    try {
      const reportCompleteNow = verifyMigrationShape(dbAfterTrust, migrations[1]);
      const reportAppliedNow = appliedMigrationNames(dbAfterTrust).includes(migrations[1].name);
      if (reportCompleteNow && !reportAppliedNow) {
        report.push(`Resolve applied: ${migrations[1].name}`);
        dbAfterTrust.close();
        resolveApplied(migrations[1].name);
      } else {
        dbAfterTrust.close();
      }
    } catch (error) {
      dbAfterTrust.close();
      throw error;
    }

    if (options.deploy ?? true) prismaDeploy();
    if (options.status) prismaStatus();
    console.log(report.join("\n"));
    return { state: backupPath ? "legacy-upgraded" : "reconciled", backupPath };
  } catch (error) {
    try {
      db.close();
    } catch {
      // already closed
    }
    throw error;
  }
}

if (require.main === module) {
  reconcilePrismaMigrations({ deploy: !process.argv.includes("--no-deploy"), status: process.argv.includes("--status") });
}
