import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";

describe("openDb", () => {
  it("uses WAL and migrates once", () => {
    const path = join(mkdtempSync(join(tmpdir(), "compliance-")), "nested", "compliance.db");
    const first = openDb(path);
    expect(first.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    first.close();
    const second = openDb(path);
    expect(second.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 1 });
    second.close();
  });

  it("keeps one result per check and one row per check and day", () => {
    const db = openDb(":memory:");
    const day = () => db.prepare("INSERT INTO check_days VALUES ('c', '2026-10-28', 1, 1, 0)").run();
    day();
    expect(day).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.prepare("INSERT INTO results VALUES ('c', 1, 'maybe', 'now')").run()).toThrow();
  });
});
