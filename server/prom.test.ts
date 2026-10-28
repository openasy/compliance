import { describe, expect, it } from "vitest";
import { parseMetrics, select } from "./prom.ts";

const text = `# HELP openasy_vulns_open_findings Open findings.
# TYPE openasy_vulns_open_findings gauge
openasy_vulns_open_findings{severity="critical"} 1
openasy_vulns_open_findings{severity="high"} 4
openasy_vulns_open_findings{severity="low",note="a \\"quoted\\" value"} 2 1700000000000
openasy_vulns_known_exploited 0
broken line
openasy_up NaN
`;

describe("Prometheus text", () => {
  it("reads names, labels and values, and leaves out what is not a sample", () => {
    const s = parseMetrics(text);
    expect(s).toHaveLength(4);
    expect(s[2]).toEqual({ name: "openasy_vulns_open_findings", labels: { severity: "low", note: 'a "quoted" value' }, value: 2 });
  });

  it("folds the samples that match", () => {
    const s = parseMetrics(text);
    expect(select(s, "openasy_vulns_open_findings")).toBe(7);
    expect(select(s, "openasy_vulns_open_findings", { severity: "critical|high" })).toBe(5);
    expect(select(s, "openasy_vulns_open_findings", {}, "max")).toBe(4);
    expect(select(s, "openasy_vulns_open_findings", {}, "min")).toBe(1);
    expect(select(s, "openasy_vulns_known_exploited")).toBe(0);
    expect(select(s, "openasy_vulns_open_findings", { severity: "none" })).toBeUndefined();
    expect(select(s, "missing")).toBeUndefined();
  });
});
