import { describe, expect, it } from "vitest";
import { CHECKS, expression, FRAMEWORKS, passes } from "./catalog.ts";

describe("catalog", () => {
  it("has unique checks, and every control names checks that exist or asks for evidence", () => {
    const ids = CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FRAMEWORKS) {
      expect(new Set(f.controls.map((c) => c.ref)).size).toBe(f.controls.length);
      for (const c of f.controls) {
        expect(c.checks.length + (c.manual ? 1 : 0), `${f.id} ${c.ref}`).toBeGreaterThan(0);
        for (const id of c.checks) expect(ids, `${f.id} ${c.ref}`).toContain(id);
      }
    }
  });

  it("uses every check in some control", () => {
    const used = new Set(FRAMEWORKS.flatMap((f) => f.controls.flatMap((c) => c.checks)));
    expect(CHECKS.filter((c) => !used.has(c.id)).map((c) => c.id)).toEqual([]);
  });

  it("reads checks as expressions", () => {
    const byId = (id: string) => CHECKS.find((c) => c.id === id)!;
    expect(expression(byId("vulns-no-kev"))).toBe("openasy_vulns_known_exploited = 0");
    expect(expression(byId("dast-no-high"))).toBe('openasy_dast_open_findings{severity=~"critical|high"} = 0');
    expect(expression(byId("backups-recent"))).toBe("time() - min(openasy_backups_last_success_timestamp_seconds) <= 2d");
  });

  it("judges values", () => {
    const now = 1_800_000_000;
    const recent = CHECKS.find((c) => c.id === "backups-recent")!;
    expect(passes(recent, now - 3600, now)).toBe(true);
    expect(passes(recent, now - 3 * 86400, now)).toBe(false);
    expect(passes(recent, 0, now)).toBe(false);
    expect(
      passes(
        CHECKS.find((c) => c.id === "posture-score")!,
        80,
        now,
      ),
    ).toBe(true);
    expect(
      passes(
        CHECKS.find((c) => c.id === "posture-score")!,
        79.9,
        now,
      ),
    ).toBe(false);
  });
});
