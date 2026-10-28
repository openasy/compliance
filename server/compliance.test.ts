import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createCompliance } from "./compliance.ts";
import { openDb } from "./db.ts";
import { fakeProducts, NOW } from "./test-app.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function setup(metrics?: Record<string, string>) {
  let now = NOW;
  const fake = await fakeProducts(metrics);
  closers.push(fake.close);
  const c = createCompliance(openDb(":memory:"), { sources: fake.sources, clock: () => now });
  return { c, fake, later: (ms: number) => (now += ms) };
}

const control = (c: Awaited<ReturnType<typeof setup>>["c"], f: string, ref: string) => c.controls({ framework: f }).find((x) => x.ref === ref)!;

describe("collection", () => {
  it("reads each product and judges its checks", async () => {
    const { c } = await setup();
    const sources = await c.collect();
    expect(sources.map((s) => [s.product, s.state])).toEqual([
      ["backups", "ok"],
      ["vulnerabilities", "ok"],
    ]);
    const checks = new Map(c.checks().map((x) => [x.id, x]));
    expect(checks.get("backups-recent")).toMatchObject({ state: "pass", value: NOW / 1000 - 7200 });
    expect(checks.get("vulns-no-critical")).toMatchObject({ state: "fail", value: 1 });
    expect(checks.get("vulns-no-kev")?.state).toBe("pass");
    expect(checks.get("sast-scanned")?.state).toBe("not-connected");
    expect(c.check("backups-tracked").days).toEqual([{ day: "2026-10-28", runs: 1, passes: 1, value: 2 }]);
  });

  it("keeps the last results but calls them unreachable when a product cannot be read", async () => {
    const { c, fake } = await setup();
    await c.collect();
    fake.down.add("backups");
    const sources = await c.collect();
    expect(sources.find((s) => s.product === "backups")).toMatchObject({ state: "failing", error: expect.stringContaining("answered 503") });
    expect(c.checks().find((x) => x.id === "backups-tracked")).toMatchObject({ state: "unreachable", value: 2 });
    expect(control(c, "iso27001", "A.8.13")).toMatchObject({
      state: "needs-evidence",
      gaps: expect.arrayContaining([{ kind: "unreachable", check: "backups-tracked" }]),
    });
  });

  it("names a metric a product does not serve as no data", async () => {
    const { c } = await setup({ backups: "openasy_backups_jobs 1\n" });
    await c.collect();
    expect(c.checks().find((x) => x.id === "backups-restore-tested")?.state).toBe("no-data");
  });
});

describe("controls", () => {
  it("pass when every check of an installed product passes, and fail on one that fails", async () => {
    const { c } = await setup();
    await c.collect();
    expect(control(c, "iso27001", "A.8.13")).toMatchObject({ state: "passing", gaps: [] });
    expect(control(c, "soc2", "A1.2").state).toBe("passing");
    // A.8.8 also names audit, which is not installed: its checks are left out.
    expect(control(c, "iso27001", "A.8.8")).toMatchObject({ state: "failing", gaps: [{ kind: "failing", check: "vulns-no-critical" }] });
  });

  it("need evidence by hand when no product proves them, or when they ask for it", async () => {
    const { c, later } = await setup();
    await c.collect();
    expect(control(c, "iso27001", "A.8.7")).toMatchObject({ state: "needs-evidence", gaps: [{ kind: "no-product" }] });
    expect(control(c, "iso27001", "A.6.3")).toMatchObject({ state: "needs-evidence", gaps: [{ kind: "evidence-missing" }] });
    const e = c.addEvidence("iso27001", "A.6.3", { title: "Training records 2026", url: "https://wiki.example.com/training", validUntil: "2026-12-31" }, "Ada");
    expect(e).toMatchObject({ valid: true, addedBy: "Ada" });
    expect(control(c, "iso27001", "A.6.3").state).toBe("passing");
    c.addEvidence("iso27001", "A.8.7", { title: "Endpoint protection report" }, "Ada");
    expect(control(c, "iso27001", "A.8.7").state).toBe("passing");
    later(70 * 86_400_000);
    expect(control(c, "iso27001", "A.6.3")).toMatchObject({ state: "needs-evidence", gaps: [{ kind: "evidence-expired" }] });
    c.deleteEvidence(e.id);
    expect(control(c, "iso27001", "A.6.3").gaps).toEqual([{ kind: "evidence-missing" }]);
    expect(() => c.deleteEvidence(e.id)).toThrow(/does not exist/);
  });

  it("refuse evidence that is not valid", async () => {
    const { c } = await setup();
    expect(() => c.addEvidence("iso27001", "A.6.3", { title: "" }, "Ada")).toThrow(/title/);
    expect(() => c.addEvidence("iso27001", "A.6.3", { title: "x", url: "javascript:alert(1)" }, "Ada")).toThrow(/http/);
    expect(() => c.addEvidence("iso27001", "A.6.3", { title: "x", validUntil: "2020-01-01" }, "Ada")).toThrow(/passed/);
    expect(() => c.addEvidence("iso27001", "Z.1", { title: "x" }, "Ada")).toThrow(/control does not exist/);
  });

  it("have an owner, and may not apply with a reason", async () => {
    const { c } = await setup();
    await c.collect();
    expect(c.updateControl("pci-dss", "6.4.2", { owner: "Web team" }).owner).toBe("Web team");
    expect(() => c.updateControl("pci-dss", "6.4.2", { applicable: false })).toThrow(/why/);
    expect(c.updateControl("pci-dss", "6.4.2", { applicable: false, reason: "No public web application" })).toMatchObject({
      state: "not-applicable",
      reason: "No public web application",
      gaps: [],
    });
    expect(c.updateControl("pci-dss", "6.4.2", { applicable: true })).toMatchObject({ applicable: true, reason: "", owner: "Web team" });
    expect(() => c.updateControl("pci-dss", "6.4.2", {})).toThrow(/at least one/);
  });

  it("are listed for enabled frameworks, and filtered", async () => {
    const { c } = await setup();
    await c.collect();
    const all = c.controls().length;
    c.setFramework("pci-dss", { enabled: false });
    expect(c.controls().length).toBe(all - 13);
    expect(c.controls({ framework: "pci-dss" })).toHaveLength(13);
    expect(c.controls({ q: "backup" }).map((x) => `${x.framework} ${x.ref}`)).toEqual(["iso27001 A.8.13", "soc2 A1.2"]);
    expect(c.controls({ state: "failing" }).every((x) => x.state === "failing")).toBe(true);
    expect(() => c.controls({ state: "fine" })).toThrow();
    expect(() => c.setFramework("hipaa", { enabled: true })).toThrow(/does not exist/);
  });
});

describe("frameworks and reports", () => {
  it("tally controls, with a trend by day", async () => {
    const { c } = await setup();
    await c.collect();
    const iso = c.frameworks().find((f) => f.id === "iso27001")!;
    expect(iso).toMatchObject({ name: "ISO/IEC 27001:2022", enabled: true, controls: 18, failing: 1 });
    expect(iso.passing + iso.failing + iso.needsEvidence + iso.notApplicable).toBe(18);
    expect(iso.days).toEqual([{ day: "2026-10-28", passing: iso.passing, total: 18 }]);
    const s = c.summary();
    expect(s.failingChecks[0]).toMatchObject({ id: "vulns-no-critical", product: "vulnerabilities" });
    expect(s.sources).toEqual({ total: 2, ok: 2, failing: 0 });
    expect(s.withoutOwner).toBe(s.totals.controls);
  });

  it("write a report in Markdown and CSV", async () => {
    const { c } = await setup();
    await c.collect();
    c.addEvidence("soc2", "CC6.1", { title: "Access review, Q3", url: 'https://wiki.example.com/q3, "final"' }, "Ada");
    const md = c.report("soc2", "md");
    expect(md.file).toBe("soc2-2026-10-28.md");
    expect(md.body).toContain("## A1.2 Backup and recovery\n\n- State: passing");
    expect(md.body).toContain("- Evidence: Access review, Q3");
    const csv = c.report("soc2", "csv");
    expect(csv.body.split("\n")[0]).toBe("control,title,state,owner,checks,evidence,not applicable because");
    expect(csv.body).toContain('"Access review, Q3 (https://wiki.example.com/q3, ""final""), valid until 2027-10-28"');
    expect(() => c.report("soc2", "pdf")).toThrow(/md or csv/);
  });
});

describe("a product that cannot be reached", () => {
  it("says why", async () => {
    // A port that was just free, so nothing answers on it.
    const free = createServer();
    await new Promise<void>((r) => free.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(free.address() as AddressInfo).port}/metrics`;
    await new Promise<void>((r) => free.close(() => r()));
    const c = createCompliance(openDb(":memory:"), { sources: [{ product: "backups", url }], clock: () => NOW });
    const [s] = await c.collect();
    expect(s).toMatchObject({ state: "failing", error: `${url}: ECONNREFUSED` });
  });
});
