// Starts the app on a random port for tests, with fake products that serve /metrics.
import { createServer, type RequestListener, type Server } from "node:http";
import { createAuth } from "@openasy/auth";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "./app.ts";
import { createCompliance, type ComplianceOptions } from "./compliance.ts";
import { openDb } from "./db.ts";

export const ADMIN_TOKEN = "test-admin-token";
export const NOW = Date.parse("2026-10-28T12:00:00Z");

/** /metrics of a backups whose jobs are all well, and a vulnerabilities with one critical finding. */
export const METRICS: Record<string, string> = {
  backups: `# HELP openasy_backups_jobs Jobs being tracked.
openasy_backups_jobs 2
openasy_backups_job_state{job="db",state="failing"} 0
openasy_backups_job_state{job="db",state="untested"} 0
openasy_backups_job_state{job="db",state="healthy"} 1
openasy_backups_job_state{job="files",state="failing"} 0
openasy_backups_job_state{job="files",state="untested"} 0
openasy_backups_job_state{job="files",state="healthy"} 1
openasy_backups_last_success_timestamp_seconds{job="db"} ${NOW / 1000 - 3600}
openasy_backups_last_success_timestamp_seconds{job="files"} ${NOW / 1000 - 7200}
`,
  vulnerabilities: `openasy_vulns_assets{kind="host"} 12
openasy_vulns_open_findings{severity="critical"} 1
openasy_vulns_open_findings{severity="high"} 4
openasy_vulns_known_exploited 0
openasy_vulns_feed_built_timestamp_seconds ${NOW / 1000 - 86400}
`,
};

/** Products that answer /metrics from `metrics`, which a test may change; one named in `down` answers 503. */
export async function fakeProducts(metrics: Record<string, string> = { ...METRICS }) {
  const down = new Set<string>();
  const server = createServer((req, res) => {
    const product = (req.url ?? "").split("/")[1] ?? "";
    if (down.has(product) || !(product in metrics)) return res.writeHead(503).end();
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }).end(metrics[product]);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    metrics,
    down,
    sources: Object.keys(metrics).map((product) => ({ product, url: `${base}/${product}/metrics` })),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export async function startApp(opts: Partial<AppOptions> & { version: string; complianceOptions?: Partial<ComplianceOptions> }) {
  const db = openDb(":memory:");
  const fake = await fakeProducts();
  const { complianceOptions, ...appOptions } = opts;
  const compliance = createCompliance(db, { sources: fake.sources, clock: () => NOW, ...complianceOptions });
  // The origin is known once the port is, so the handler is set after listening.
  let handler: RequestListener = (_req, res) => res.writeHead(503).end();
  const server: Server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const auth = createAuth({ db, product: "compliance", productName: "OpenAsy Compliance", origin: base });
  handler = createApp({ db, compliance, auth, adminToken: ADMIN_TOKEN, ...appOptions });
  const admin = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json", ...init.headers } });
  const get = async (path: string) => (await (await admin(path)).json()) as any;
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fake.close();
  };
  return { db, compliance, auth, base, admin, get, fake, close };
}
