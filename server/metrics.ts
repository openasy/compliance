// Prometheus text exposition, written by hand: a few lines, no client library needed.
const requests = new Map<string, number>();

export function countRequest(method: string, route: string, status: number) {
  const key = `method="${method}",route="${route}",status="${status}"`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
}

export interface Gauges {
  /** Controls of the enabled frameworks by state. */
  controls: Array<{ state: string; n: number }>;
  sourcesFailing: number;
}

export function renderMetrics(version: string, g: Gauges): string {
  const lines = [
    "# HELP openasy_build_info Build information.",
    "# TYPE openasy_build_info gauge",
    `openasy_build_info{product="compliance",version="${version}"} 1`,
    "# HELP openasy_http_requests_total HTTP requests handled.",
    "# TYPE openasy_http_requests_total counter",
    ...[...requests].map(([labels, n]) => `openasy_http_requests_total{${labels}} ${n}`),
    "# HELP openasy_compliance_controls Controls of the enabled frameworks by state.",
    "# TYPE openasy_compliance_controls gauge",
    ...g.controls.map((c) => `openasy_compliance_controls{state="${c.state}"} ${c.n}`),
    "# HELP openasy_compliance_sources_failing Products whose /metrics could not be read the last time.",
    "# TYPE openasy_compliance_sources_failing gauge",
    `openasy_compliance_sources_failing ${g.sourcesFailing}`,
    "# HELP process_uptime_seconds Seconds since the process started.",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${process.uptime().toFixed(0)}`,
  ];
  return lines.join("\n") + "\n";
}
