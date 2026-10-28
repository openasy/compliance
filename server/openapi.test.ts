import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_TOKEN, startApp } from "./test-app.ts";

// Contract tests (ADR 0024): every response the API sends must match openapi.json.

type Spec = {
  info: { version: string };
  paths: Record<string, Record<string, { responses: Record<string, { $ref?: string; content?: Record<string, { schema: object }> }> }>>;
  components: { responses: Record<string, { content: Record<string, { schema: object }> }> };
};

const spec = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as Spec;
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema(spec, "openapi");

const docsDir = mkdtempSync(join(tmpdir(), "compliance-docs-"));
writeFileSync(join(docsDir, "index.html"), "<!doctype html><title>API</title>");

let app: Awaited<ReturnType<typeof startApp>>;
let base: string;
const covered = new Set<string>();

beforeAll(async () => {
  app = await startApp({ version, openapi: spec, docsDir });
  base = app.base;
});

afterAll(() => app.close());

/** Calls the API and checks status, content type and body against the description. */
async function call(method: string, path: string, init: RequestInit = {}, concrete = path) {
  const res = await fetch(base + concrete, { ...init, method });
  const operation = spec.paths[path]?.[method.toLowerCase()];
  expect(operation, `${method} ${path} is not in openapi.json`).toBeDefined();
  covered.add(`${method} ${path}`);

  const declared = operation!.responses[String(res.status)];
  expect(declared, `${method} ${concrete} answered ${res.status}, which openapi.json does not list`).toBeDefined();
  // A response is either inline or a $ref to components/responses; build the JSON pointer to its schema either way.
  const shared = declared!.$ref?.split("/").pop();
  const response = shared ? spec.components.responses[shared]! : declared!;
  const at = shared
    ? `openapi#/components/responses/${shared}`
    : `openapi#/paths/${path.replaceAll("/", "~1")}/${method.toLowerCase()}/responses/${res.status}`;

  if (!response.content) {
    expect(res.headers.get("content-length") ?? "0", `${method} ${path} ${res.status} should have no body`).toBe("0");
    return { res, body: undefined };
  }
  const type = res.headers.get("content-type")!.split(";")[0]!;
  expect(response.content?.[type], `${method} ${path} ${res.status} sent ${type}, which openapi.json does not list`).toBeDefined();

  const body = type.endsWith("json") ? await res.json() : await res.text();
  const schema = `${at}/content/${type.replace("/", "~1")}/schema`;
  const validate = ajv.getSchema(schema)!;
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return { res, body };
}

const auth = (token: string, body?: string, type = "application/json") => ({
  headers: { authorization: `Bearer ${token}`, "content-type": type },
  ...(body !== undefined && { body }),
});
const admin = (body?: unknown) => auth(ADMIN_TOKEN, body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));

describe("openapi.json", () => {
  it("has the version of this release", () => {
    expect(spec.info.version).toBe(version);
  });

  it("is served with the running version", async () => {
    const served = (await (await fetch(`${base}/api/openapi.json`)).json()) as Spec;
    expect(served.info.version).toBe(version);
    // compliance's own operations, then sign-in from @openasy/auth (tested against its description in that package).
    expect(Object.keys(served.paths).filter((p) => !p.startsWith("/api/v1/auth/"))).toEqual(Object.keys(spec.paths));
    expect(served.paths["/api/v1/auth/login"]).toBeDefined();
  });

  it("serves the API reference at /api/docs/", async () => {
    expect((await fetch(`${base}/api/docs`, { redirect: "manual" })).headers.get("location")).toBe("/api/docs/");
    const res = await fetch(`${base}/api/docs/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect((await fetch(`${base}/api/docs/../../package.json`)).status).not.toBe(200);
  });
});

describe("responses match openapi.json", () => {
  let evidence = "";

  it("product and health", async () => {
    await call("GET", "/api/v1/version");
    await call("GET", "/api/v1/products", admin());
    await call("GET", "/api/v1/products", {});
    await call("GET", "/healthz");
    await call("GET", "/readyz");
    await call("GET", "/metrics");
  });

  it("collection, checks and sources", async () => {
    await call("GET", "/api/v1/sources", admin());
    await call("POST", "/api/v1/collect", { method: "POST", ...admin() });
    await call("POST", "/api/v1/collect", { method: "POST" });
    await call("GET", "/api/v1/sources", {});
    await call("GET", "/api/v1/checks", admin());
    await call("GET", "/api/v1/checks", {});
    await call("GET", "/api/v1/checks/{id}", admin(), "/api/v1/checks/backups-recent");
    await call("GET", "/api/v1/checks/{id}", admin(), "/api/v1/checks/missing");
    await call("GET", "/api/v1/checks/{id}", {}, "/api/v1/checks/backups-recent");
  });

  it("controls and evidence", async () => {
    await call("GET", "/api/v1/controls", admin());
    await call("GET", "/api/v1/controls", admin(), "/api/v1/controls?framework=soc2&state=failing&q=cc");
    await call("GET", "/api/v1/controls", admin(), "/api/v1/controls?framework=hipaa");
    await call("GET", "/api/v1/controls", admin(), "/api/v1/controls?state=fine");
    await call("GET", "/api/v1/controls", {});
    const c = "/api/v1/controls/{framework}/{ref}";
    await call("GET", c, admin(), "/api/v1/controls/iso27001/A.8.13");
    await call("GET", c, admin(), `/api/v1/controls/gdpr/${encodeURIComponent("Art. 32")}`);
    await call("GET", c, admin(), "/api/v1/controls/iso27001/Z.9");
    await call("GET", c, {}, "/api/v1/controls/iso27001/A.8.13");
    await call("PATCH", c, admin({ owner: "Ops" }), "/api/v1/controls/iso27001/A.8.13");
    await call("PATCH", c, admin({ applicable: false }), "/api/v1/controls/iso27001/A.8.13");
    await call("PATCH", c, admin("nope"), "/api/v1/controls/iso27001/A.8.13");
    await call("PATCH", c, admin({ owner: "x" }), "/api/v1/controls/iso27001/Z.9");
    await call("PATCH", c, { method: "PATCH" }, "/api/v1/controls/iso27001/A.8.13");
    const e = `${c}/evidence`;
    evidence = (
      (await call("POST", e, admin({ title: "Training records", validUntil: "2027-01-31" }), "/api/v1/controls/iso27001/A.6.3/evidence")).body as { id: string }
    ).id;
    await call("POST", e, admin({ title: "" }), "/api/v1/controls/iso27001/A.6.3/evidence");
    await call("POST", e, admin("nope"), "/api/v1/controls/iso27001/A.6.3/evidence");
    await call("POST", e, admin({ title: "x" }), "/api/v1/controls/iso27001/Z.9/evidence");
    await call("POST", e, { method: "POST" }, "/api/v1/controls/iso27001/A.6.3/evidence");
    await call("GET", c, admin(), "/api/v1/controls/iso27001/A.6.3");
  });

  it("frameworks and reports", async () => {
    await call("GET", "/api/v1/frameworks", admin());
    await call("GET", "/api/v1/frameworks", {});
    const f = "/api/v1/frameworks/{framework}";
    await call("PUT", f, admin({ enabled: false }), "/api/v1/frameworks/gdpr");
    await call("PUT", f, admin({ enabled: "no" }), "/api/v1/frameworks/gdpr");
    await call("PUT", f, admin("nope"), "/api/v1/frameworks/gdpr");
    await call("PUT", f, admin({ enabled: true }), "/api/v1/frameworks/hipaa");
    await call("PUT", f, { method: "PUT" }, "/api/v1/frameworks/gdpr");
    const r = `${f}/report`;
    await call("GET", r, admin(), "/api/v1/frameworks/iso27001/report");
    await call("GET", r, admin(), "/api/v1/frameworks/iso27001/report?format=csv");
    await call("GET", r, admin(), "/api/v1/frameworks/iso27001/report?format=pdf");
    await call("GET", r, admin(), "/api/v1/frameworks/hipaa/report");
    await call("GET", r, {}, "/api/v1/frameworks/iso27001/report");
    await call("GET", "/api/v1/summary", admin());
    await call("GET", "/api/v1/summary", {});
  });

  it("deletes evidence", async () => {
    await call("DELETE", "/api/v1/evidence/{id}", admin(), `/api/v1/evidence/${evidence}`);
    await call("DELETE", "/api/v1/evidence/{id}", admin(), `/api/v1/evidence/${evidence}`);
    await call("DELETE", "/api/v1/evidence/{id}", { method: "DELETE" }, "/api/v1/evidence/x");
  });

  it("covers every operation in openapi.json", () => {
    const all = Object.entries(spec.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`));
    expect([...covered].sort()).toEqual(all.sort());
  });
});
