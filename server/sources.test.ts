import { describe, expect, it } from "vitest";
import { parseSources } from "./sources.ts";

describe("sources", () => {
  it("reads each product with checks at its address, and lets COMPLIANCE_SOURCES name another", () => {
    const products = [
      { id: "backups", url: "https://backups.example.com" },
      { id: "vulnerabilities", url: "https://vulns.example.com" },
      { id: "identity", url: "https://id.example.com" },
    ];
    expect(parseSources(products, "vulnerabilities=http://vulns:9090/metrics, nope=http://x, backups=ftp://x")).toEqual({
      sources: [
        { product: "backups", url: "https://backups.example.com/metrics" },
        { product: "vulnerabilities", url: "http://vulns:9090/metrics" },
      ],
      invalid: ["nope=http://x", "backups=ftp://x"],
    });
    expect(parseSources([], undefined)).toEqual({ sources: [], invalid: [] });
  });
});
