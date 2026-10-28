import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Forward-only migrations (ADR 0010): append new entries, never edit or remove old ones.
const MIGRATIONS = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   -- How the last read of each product's /metrics went. The addresses come from the environment.
   CREATE TABLE sources (
     product TEXT PRIMARY KEY,
     url TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('ok', 'failing')),
     last_at TEXT NOT NULL,
     last_ok_at TEXT,
     error TEXT
   );
   -- The latest result of each check (ADR 0058).
   CREATE TABLE results (
     check_id TEXT PRIMARY KEY,
     value REAL,
     state TEXT NOT NULL CHECK (state IN ('pass', 'fail', 'no-data')),
     at TEXT NOT NULL
   );
   -- Each day of each check: how many reads, how many passed, and the last value. The evidence of a period.
   CREATE TABLE check_days (
     check_id TEXT NOT NULL,
     day TEXT NOT NULL,
     runs INTEGER NOT NULL,
     passes INTEGER NOT NULL,
     last_value REAL NOT NULL,
     PRIMARY KEY (check_id, day)
   ) WITHOUT ROWID;
   -- What people say about a control: who owns it, and whether it applies.
   CREATE TABLE controls (
     framework TEXT NOT NULL,
     ref TEXT NOT NULL,
     owner TEXT NOT NULL DEFAULT '',
     applicable INTEGER NOT NULL DEFAULT 1,
     reason TEXT NOT NULL DEFAULT '',
     PRIMARY KEY (framework, ref)
   ) WITHOUT ROWID;
   -- Evidence a person adds for a control: a document, a record, a link. It counts until valid_until.
   CREATE TABLE evidence (
     id TEXT PRIMARY KEY,
     framework TEXT NOT NULL,
     ref TEXT NOT NULL,
     title TEXT NOT NULL,
     url TEXT NOT NULL DEFAULT '',
     note TEXT NOT NULL DEFAULT '',
     valid_until TEXT NOT NULL,
     added_by TEXT NOT NULL,
     added_at TEXT NOT NULL
   );
   CREATE INDEX evidence_control ON evidence (framework, ref);
   -- Each day of each framework: controls passing out of those that apply, for the trend.
   CREATE TABLE framework_days (
     framework TEXT NOT NULL,
     day TEXT NOT NULL,
     passing INTEGER NOT NULL,
     total INTEGER NOT NULL,
     PRIMARY KEY (framework, day)
   ) WITHOUT ROWID`,
];

/** Opens the product's single SQLite file in WAL mode (ADR 0011) and migrates it forward. */
export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number };
  for (let v = row.v; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v + 1, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}
