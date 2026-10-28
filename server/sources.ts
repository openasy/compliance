// Where compliance reads each product (ADR 0058): its address from OPENASY_PRODUCTS with /metrics after it, unless
// COMPLIANCE_SOURCES names another, as it must when a product serves /metrics on a port of its own (ADR 0026).
import { CHECKS } from "./catalog.ts";
import type { ProductLink } from "./products.ts";

export function parseSources(products: ProductLink[], value: string | undefined): { sources: Array<{ product: string; url: string }>; invalid: string[] } {
  const known = new Set(CHECKS.map((c) => c.product));
  const urls = new Map<string, string>();
  for (const p of products) if (known.has(p.id)) urls.set(p.id, `${p.url}/metrics`);
  const invalid: string[] = [];
  for (const entry of (value ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const at = entry.indexOf("=");
    const id = entry.slice(0, at).trim();
    const url = URL.parse(entry.slice(at + 1).trim());
    if (at < 1 || !known.has(id) || !url || (url.protocol !== "https:" && url.protocol !== "http:")) {
      invalid.push(entry);
      continue;
    }
    urls.set(id, url.href);
  }
  return { sources: [...urls].map(([product, url]) => ({ product, url })).sort((a, b) => a.product.localeCompare(b.product)), invalid };
}
