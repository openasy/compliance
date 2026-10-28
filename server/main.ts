import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createAuth, oidcFromEnv, readSecretsKey } from "@openasy/auth";
import { createApp, createMetricsHandler } from "./app.ts";
import { createCompliance } from "./compliance.ts";
import { openDb } from "./db.ts";
import { log } from "./log.ts";
import { parseProducts } from "./products.ts";
import { parseSources } from "./sources.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.COMPLIANCE_DB ?? "/data/compliance.db";
const webDir = new URL("../dist/web", import.meta.url).pathname;
const docsDir = new URL("../dist/docs", import.meta.url).pathname;
const openapi = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as Record<string, unknown>;
const headless = process.env.COMPLIANCE_HEADLESS === "true";
// Set it to keep /metrics off the port that is published or behind an ingress (ADR 0026).
const metricsPort = process.env.COMPLIANCE_METRICS_PORT ? Number(process.env.COMPLIANCE_METRICS_PORT) : undefined;
const collectMinutes = Number(process.env.COMPLIANCE_COLLECT_MINUTES ?? 15);

if (!Number.isFinite(collectMinutes) || collectMinutes < 1 || collectMinutes > 1440) throw new Error("COMPLIANCE_COLLECT_MINUTES must be 1 to 1440");

const db = openDb(dbPath);
// The address people open compliance at, behind the TLS proxy (ADR 0026). Cookies, passkeys and OIDC redirects use it.
const publicUrl = (process.env.COMPLIANCE_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const secretsKeyFile = process.env.COMPLIANCE_SECRETS_KEY_FILE ?? "/run/secrets/openasy-kek";
const auth = createAuth({
  db,
  product: "compliance",
  productName: "OpenAsy Compliance",
  origin: publicUrl,
  // Locally the same compliance is often opened as 127.0.0.1 too.
  trustedOrigins: publicUrl.startsWith("http://localhost:") ? [publicUrl.replace("localhost", "127.0.0.1")] : [],
  passwords: process.env.COMPLIANCE_PASSWORD_SIGN_IN !== "false",
  oidc: oidcFromEnv(process.env, "COMPLIANCE_"),
  secretsKey: readSecretsKey(secretsKeyFile),
  // Audit log (ADR 0013): every sign-in, failure and change to members and tokens.
  onEvent: (event) => log(event.type === "sign-in-failed" ? "warn" : "info", "auth", { event }),
});
const products = parseProducts(process.env.OPENASY_PRODUCTS);
if (products.invalid.length) log("warn", "OPENASY_PRODUCTS: left out entries that are not id=https://address", { entries: products.invalid });
const sources = parseSources(products.products, process.env.COMPLIANCE_SOURCES);
if (sources.invalid.length)
  log("warn", "COMPLIANCE_SOURCES: left out entries that are not product=https://address/metrics of a product with checks", { entries: sources.invalid });

const compliance = createCompliance(db, { sources: sources.sources });
const server = createServer(
  createApp({
    db,
    compliance,
    version,
    auth,
    webDir: !headless && existsSync(webDir) ? webDir : undefined,
    docsDir: existsSync(docsDir) ? docsDir : undefined,
    openapi,
    serveMetrics: metricsPort === undefined,
    products: products.products,
  }),
);
const metricsServer = metricsPort !== undefined ? createServer(createMetricsHandler(compliance, version)) : undefined;
metricsServer?.listen(metricsPort, () => log("info", "metrics on their own port", { port: metricsPort }));

server.listen(port, () =>
  log("info", "compliance started", { version, port, db: dbPath, headless, sources: sources.sources.map((s) => s.product), collectMinutes }),
);
if (!sources.sources.length)
  log("warn", "no product to read: set OPENASY_PRODUCTS to the install's products, or COMPLIANCE_SOURCES to their /metrics addresses");
if (!publicUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(publicUrl)) {
  log("warn", "COMPLIANCE_PUBLIC_URL is not https: browsers will not keep secure cookies or allow passkeys. Put compliance behind TLS (ADR 0026)", {
    url: publicUrl,
  });
}
if (auth.secretsInClear)
  log("warn", "no secrets key: TOTP secrets are stored unencrypted. Mount a 32-byte key (openssl rand -hex 32)", { file: secretsKeyFile });
const setup = auth.setupLink();
// No default password (ADR 0013): the first person to open this link becomes the owner.
if (setup) log("info", "no owner yet: open this link once to create the owner account", { url: setup });

// One read at a time: a slow product must not have two reads of the same checks at once.
let collecting = false;
const collect = () => {
  if (collecting) return;
  collecting = true;
  void compliance
    .collect()
    .then((s) => {
      const failing = s.filter((x) => x.state === "failing");
      if (failing.length) log("warn", "products not read", { sources: failing.map((x) => ({ product: x.product, error: x.error })) });
    })
    .catch((err: unknown) => log("error", "collect", { error: String(err) }))
    .finally(() => (collecting = false));
};
compliance.purge();
collect();
const timers: NodeJS.Timeout[] = [
  setInterval(() => auth.purge(), 5 * 60_000),
  setInterval(() => compliance.purge(), 24 * 3_600_000),
  setInterval(collect, collectMinutes * 60_000),
];

function shutdown(signal: string) {
  log("info", "shutting down", { signal });
  for (const t of timers) clearInterval(t);
  metricsServer?.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
