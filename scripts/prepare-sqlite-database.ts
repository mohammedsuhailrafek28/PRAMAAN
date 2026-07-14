import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import "dotenv/config";
import { sqlitePathFromDatabaseUrl } from "./reconcile-prisma-migrations.js";

const dbPath = sqlitePathFromDatabaseUrl();
mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.close();
console.log(`Prepared SQLite database file at ${dbPath}`);
