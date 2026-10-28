// Reads the Prometheus text format every OpenAsy product serves at /metrics, and picks values out of it. Only what a
// check needs: names, labels and values; HELP, TYPE, timestamps and exemplars are left out.

export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const unescape = (v: string) => v.replace(/\\(["\\n])/g, (_, c: string) => (c === "n" ? "\n" : c));

/** The samples of a /metrics answer. A line that is not a sample is left out, never an error. */
export function parseMetrics(text: string): Sample[] {
  const out: Sample[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const value = Number(m[4] === "+Inf" ? Infinity : m[4] === "-Inf" ? -Infinity : m[4]);
    if (Number.isNaN(value)) continue;
    const labels: Record<string, string> = {};
    for (const l of (m[3] ?? "").matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]!] = unescape(l[2]!);
    out.push({ name: m[1]!, labels, value });
  }
  return out;
}

export type Aggregate = "sum" | "min" | "max";

/**
 * The samples named `name` whose labels match, folded into one number; undefined when there are none. A matcher's
 * value may name several with `|`, such as critical|high.
 */
export function select(samples: Sample[], name: string, match: Record<string, string> = {}, agg: Aggregate = "sum"): number | undefined {
  const found = samples.filter((s) => s.name === name && Object.entries(match).every(([k, v]) => v.split("|").includes(s.labels[k] ?? "")));
  if (!found.length) return undefined;
  const values = found.map((s) => s.value);
  return agg === "sum" ? values.reduce((a, b) => a + b, 0) : agg === "min" ? Math.min(...values) : Math.max(...values);
}
