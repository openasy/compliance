import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "./test-app.ts";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp({ version: "0.1.0" });
  await app.admin("/api/v1/collect", { method: "POST" });
});
afterAll(() => app.close());

describe("the API", () => {
  it("needs a signed-in person or a token", async () => {
    expect((await fetch(`${app.base}/api/v1/controls`)).status).toBe(401);
    expect((await fetch(`${app.base}/api/v1/version`)).status).toBe(200);
  });

  it("finds a control by a reference with spaces and dots", async () => {
    const c = await app.get(`/api/v1/controls/gdpr/${encodeURIComponent("Art. 32")}`);
    expect(c).toMatchObject({ framework: "gdpr", ref: "Art. 32", frameworkName: "GDPR", state: "failing" });
    expect(c.results.map((r: any) => r.id)).toEqual(["vulns-no-critical", "backups-restore-tested", "certificates-none-expiring", "posture-score"]);
  });

  it("sends a report as a file", async () => {
    const res = await app.admin("/api/v1/frameworks/soc2/report?format=csv");
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="soc2-2026-10-28.csv"');
    expect((await res.text()).startsWith("control,title,state")).toBe(true);
  });

  it("has metrics for Prometheus", async () => {
    const metrics = await (await fetch(`${app.base}/metrics`)).text();
    expect(metrics).toContain('openasy_build_info{product="compliance",version="0.1.0"} 1');
    expect(metrics).toMatch(/openasy_compliance_controls\{state="failing"\} [1-9]/);
    expect(metrics).toContain("openasy_compliance_sources_failing 0");
  });
});
