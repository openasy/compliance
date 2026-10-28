// What compliance knows: checks, each a number another product serves at /metrics and what it must be, and the
// controls of each framework with the checks that prove them (ADR 0058). Controls software cannot prove ask for
// evidence added by hand. Control titles are short names, not the standards' text.
import type { Aggregate } from "./prom.ts";

export type Op = "eq" | "le" | "ge" | "within";

export interface Check {
  id: string;
  /** The OpenAsy product that serves the metric, by its id in OPENASY_PRODUCTS. */
  product: string;
  title: string;
  metric: string;
  match?: Record<string, string>;
  agg?: Aggregate;
  op: Op;
  /** For within: seconds; the metric is a Unix time that must be at most this old. */
  value: number;
}

const DAY = 86_400;

export const CHECKS: Check[] = [
  // Backups
  { id: "backups-tracked", product: "backups", title: "Backup jobs are tracked", metric: "openasy_backups_jobs", op: "ge", value: 1 },
  {
    id: "backups-none-failing",
    product: "backups",
    title: "No backup job is failing",
    metric: "openasy_backups_job_state",
    match: { state: "failing" },
    op: "eq",
    value: 0,
  },
  {
    id: "backups-restore-tested",
    product: "backups",
    title: "Every backup job has a restore test",
    metric: "openasy_backups_job_state",
    match: { state: "untested" },
    op: "eq",
    value: 0,
  },
  {
    id: "backups-recent",
    product: "backups",
    title: "Every backup job made a backup in the last 2 days",
    metric: "openasy_backups_last_success_timestamp_seconds",
    agg: "min",
    op: "within",
    value: 2 * DAY,
  },
  // Vulnerabilities
  {
    id: "vulns-assets",
    product: "vulnerabilities",
    title: "Hosts and images are scanned for vulnerabilities",
    metric: "openasy_vulns_assets",
    op: "ge",
    value: 1,
  },
  {
    id: "vulns-no-critical",
    product: "vulnerabilities",
    title: "No critical vulnerability is open",
    metric: "openasy_vulns_open_findings",
    match: { severity: "critical" },
    op: "eq",
    value: 0,
  },
  {
    id: "vulns-no-kev",
    product: "vulnerabilities",
    title: "No known exploited vulnerability is open",
    metric: "openasy_vulns_known_exploited",
    op: "eq",
    value: 0,
  },
  {
    id: "vulns-feed-fresh",
    product: "vulnerabilities",
    title: "Vulnerability data is at most 3 days old",
    metric: "openasy_vulns_feed_built_timestamp_seconds",
    agg: "min",
    op: "within",
    value: 3 * DAY,
  },
  // Code and dependencies
  { id: "sast-scanned", product: "sast", title: "Repositories are scanned for flaws in code", metric: "openasy_sast_repositories", op: "ge", value: 1 },
  {
    id: "sast-no-critical",
    product: "sast",
    title: "No critical code flaw is open on a default branch",
    metric: "openasy_sast_open_findings",
    match: { severity: "critical" },
    op: "eq",
    value: 0,
  },
  {
    id: "sast-checks-pass",
    product: "sast",
    title: "Code scans of the last 7 days passed their check",
    metric: "openasy_sast_failing_checks",
    op: "eq",
    value: 0,
  },
  { id: "secrets-scanned", product: "secrets", title: "Repositories are scanned for secrets", metric: "openasy_secrets_repositories", op: "ge", value: 1 },
  { id: "secrets-none-open", product: "secrets", title: "No secret is open in a repository", metric: "openasy_secrets_open_findings", op: "eq", value: 0 },
  { id: "audit-projects", product: "audit", title: "Projects' dependencies are audited", metric: "openasy_audit_projects", op: "ge", value: 1 },
  {
    id: "audit-no-critical",
    product: "audit",
    title: "No critical advisory is open in a dependency",
    metric: "openasy_audit_open_findings",
    match: { severity: "critical" },
    op: "eq",
    value: 0,
  },
  { id: "dast-targets", product: "dast", title: "Web applications are tested while they run", metric: "openasy_dast_targets", op: "ge", value: 1 },
  {
    id: "dast-no-high",
    product: "dast",
    title: "No critical or high web application finding is open",
    metric: "openasy_dast_open_findings",
    match: { severity: "critical|high" },
    op: "eq",
    value: 0,
  },
  {
    id: "supply-chain-none-denied",
    product: "supply-chain",
    title: "No image the policy denies",
    metric: "openasy_supply_chain_images_denied",
    op: "eq",
    value: 0,
  },
  {
    id: "supply-chain-sbom",
    product: "supply-chain",
    title: "Every image has an SBOM",
    metric: "openasy_supply_chain_images_without_sbom",
    op: "eq",
    value: 0,
  },
  // Hosts, configuration and malware
  { id: "infra-hosts", product: "infrastructure", title: "Hosts are in the inventory", metric: "openasy_infra_hosts", op: "ge", value: 1 },
  { id: "posture-targets", product: "posture", title: "Configuration is checked against benchmarks", metric: "openasy_posture_targets", op: "ge", value: 1 },
  {
    id: "posture-score",
    product: "posture",
    title: "Every target passes at least 80% of its benchmark",
    metric: "openasy_posture_score",
    agg: "min",
    op: "ge",
    value: 80,
  },
  {
    id: "posture-no-critical",
    product: "posture",
    title: "No critical configuration control fails",
    metric: "openasy_posture_open_findings",
    match: { severity: "critical" },
    op: "eq",
    value: 0,
  },
  {
    id: "malware-scanned",
    product: "malware",
    title: "Hosts, buckets and images are scanned for malware",
    metric: "openasy_malware_sources",
    op: "ge",
    value: 1,
  },
  { id: "malware-none-open", product: "malware", title: "No malware detection is undecided", metric: "openasy_malware_open_detections", op: "eq", value: 0 },
  // Certificates
  {
    id: "certificates-none-expiring",
    product: "certificates",
    title: "No certificate is expired or about to expire",
    metric: "openasy_certificates_expiring",
    match: { state: "critical|expired" },
    op: "eq",
    value: 0,
  },
  {
    id: "certificates-endpoints-ok",
    product: "certificates",
    title: "Every TLS endpoint answers",
    metric: "openasy_certificates_endpoints_failing",
    op: "eq",
    value: 0,
  },
  // Logging and monitoring
  { id: "logs-sources", product: "logs", title: "Logs are collected", metric: "openasy_logs_sources", op: "ge", value: 1 },
  { id: "logs-store-up", product: "logs", title: "The log store is running", metric: "openasy_logs_victorialogs_up", op: "eq", value: 1 },
  {
    id: "siem-rules-enabled",
    product: "siem",
    title: "Detection rules are enabled",
    metric: "openasy_siem_rules",
    match: { state: "enabled" },
    op: "ge",
    value: 1,
  },
  {
    id: "siem-rules-not-failing",
    product: "siem",
    title: "No detection rule is failing",
    metric: "openasy_siem_rules",
    match: { state: "failing" },
    op: "eq",
    value: 0,
  },
  {
    id: "siem-no-critical-open",
    product: "siem",
    title: "No critical security signal is open",
    metric: "openasy_siem_open_signals",
    match: { severity: "critical" },
    op: "eq",
    value: 0,
  },
  { id: "uptime-checks", product: "uptime", title: "Services are checked for availability", metric: "openasy_uptime_checks", op: "ge", value: 1 },
  { id: "deception-canaries", product: "deception", title: "Canaries are planted", metric: "openasy_deception_canaries", op: "ge", value: 1 },
  { id: "deception-no-open", product: "deception", title: "No canary trigger is undecided", metric: "openasy_deception_triggers_open", op: "eq", value: 0 },
  {
    id: "threat-intel-feeds",
    product: "threat-intel",
    title: "Threat feeds are pulled without failing",
    metric: "openasy_threat_intel_feed_pulls",
    match: { state: "failing" },
    op: "eq",
    value: 0,
  },
  {
    id: "threat-intel-indicators",
    product: "threat-intel",
    title: "Threat indicators are in force",
    metric: "openasy_threat_intel_indicators",
    op: "ge",
    value: 1,
  },
  // Incidents and risk
  {
    id: "incidents-postmortems",
    product: "incidents",
    title: "Every resolved incident has a postmortem",
    metric: "openasy_incidents_awaiting_postmortem",
    op: "eq",
    value: 0,
  },
  { id: "risk-reviews", product: "risk", title: "No risk review is overdue", metric: "openasy_risk_overdue_reviews", op: "eq", value: 0 },
  { id: "risk-acceptances", product: "risk", title: "No risk acceptance has run out", metric: "openasy_risk_review_due", op: "eq", value: 0 },
  { id: "risk-vendor-reviews", product: "risk", title: "No vendor review is overdue", metric: "openasy_risk_vendor_reviews_overdue", op: "eq", value: 0 },
];

export interface Control {
  /** The control's own reference, such as A.8.13 or CC7.2. */
  ref: string;
  title: string;
  checks: string[];
  /** What a person must add when software cannot prove it, such as training records. */
  manual?: string;
}

export interface Framework {
  id: string;
  name: string;
  controls: Control[];
}

const BACKUPS = ["backups-tracked", "backups-none-failing", "backups-restore-tested", "backups-recent"];

export const FRAMEWORKS: Framework[] = [
  {
    id: "iso27001",
    name: "ISO/IEC 27001:2022",
    controls: [
      { ref: "A.5.7", title: "Threat intelligence", checks: ["threat-intel-feeds", "threat-intel-indicators"] },
      { ref: "A.5.9", title: "Inventory of assets", checks: ["infra-hosts"] },
      { ref: "A.5.19", title: "Security in supplier relationships", checks: ["risk-vendor-reviews"] },
      { ref: "A.5.21", title: "Security in the ICT supply chain", checks: ["supply-chain-none-denied", "supply-chain-sbom", "audit-projects"] },
      { ref: "A.5.24", title: "Incident management planning", checks: [], manual: "The incident response plan, with who does what" },
      { ref: "A.5.26", title: "Response to security incidents", checks: ["siem-no-critical-open", "deception-no-open"] },
      { ref: "A.5.27", title: "Learning from security incidents", checks: ["incidents-postmortems"] },
      { ref: "A.5.35", title: "Independent review of information security", checks: [], manual: "The report of the last independent review or internal audit" },
      { ref: "A.6.3", title: "Security awareness and training", checks: [], manual: "Training records of the last year" },
      { ref: "A.8.7", title: "Protection against malware", checks: ["malware-scanned", "malware-none-open"] },
      {
        ref: "A.8.8",
        title: "Management of technical vulnerabilities",
        checks: ["vulns-assets", "vulns-no-critical", "vulns-no-kev", "vulns-feed-fresh", "audit-no-critical"],
      },
      { ref: "A.8.9", title: "Configuration management", checks: ["posture-targets", "posture-score", "posture-no-critical"] },
      { ref: "A.8.13", title: "Information backup", checks: BACKUPS },
      { ref: "A.8.15", title: "Logging", checks: ["logs-sources", "logs-store-up"] },
      { ref: "A.8.16", title: "Monitoring activities", checks: ["siem-rules-enabled", "siem-rules-not-failing", "uptime-checks", "deception-canaries"] },
      { ref: "A.8.24", title: "Use of cryptography", checks: ["certificates-none-expiring", "certificates-endpoints-ok"] },
      { ref: "A.8.28", title: "Secure coding", checks: ["sast-scanned", "sast-no-critical", "secrets-scanned", "secrets-none-open"] },
      { ref: "A.8.29", title: "Security testing in development and acceptance", checks: ["dast-targets", "dast-no-high", "sast-checks-pass"] },
    ],
  },
  {
    id: "soc2",
    name: "SOC 2",
    controls: [
      { ref: "CC3.2", title: "Identifies and analyzes risk", checks: ["risk-reviews", "risk-acceptances"] },
      { ref: "CC6.1", title: "Logical access security", checks: [], manual: "The access review of the last quarter" },
      { ref: "CC6.6", title: "Protection against threats from outside the boundary", checks: ["dast-no-high", "certificates-none-expiring"] },
      { ref: "CC6.8", title: "Prevents unauthorized or malicious software", checks: ["malware-none-open", "supply-chain-none-denied"] },
      { ref: "CC7.1", title: "Detects configuration changes and vulnerabilities", checks: ["posture-score", "vulns-no-critical", "vulns-no-kev"] },
      {
        ref: "CC7.2",
        title: "Monitors system components for anomalies",
        checks: ["siem-rules-enabled", "logs-sources", "deception-canaries", "uptime-checks"],
      },
      { ref: "CC7.3", title: "Evaluates security events", checks: ["siem-no-critical-open", "deception-no-open"] },
      { ref: "CC7.4", title: "Responds to security incidents", checks: [], manual: "The incident response plan and its last exercise" },
      { ref: "CC7.5", title: "Recovers from security incidents", checks: ["incidents-postmortems"] },
      { ref: "CC8.1", title: "Manages changes", checks: ["sast-checks-pass", "secrets-none-open"] },
      { ref: "CC9.2", title: "Assesses vendor and partner risk", checks: ["risk-vendor-reviews"] },
      { ref: "A1.2", title: "Backup and recovery", checks: BACKUPS },
    ],
  },
  {
    id: "gdpr",
    name: "GDPR",
    controls: [
      { ref: "Art. 28", title: "Processors", checks: ["risk-vendor-reviews"], manual: "Data processing agreements with each processor" },
      { ref: "Art. 30", title: "Records of processing activities", checks: [], manual: "The record of processing activities" },
      {
        ref: "Art. 32",
        title: "Security of processing",
        checks: ["vulns-no-critical", "backups-restore-tested", "certificates-none-expiring", "posture-score"],
      },
      { ref: "Art. 33", title: "Notifying a personal data breach", checks: ["incidents-postmortems"], manual: "The breach notification procedure" },
      { ref: "Art. 35", title: "Data protection impact assessment", checks: [], manual: "The impact assessments of high-risk processing" },
    ],
  },
  {
    id: "pci-dss",
    name: "PCI DSS 4.0",
    controls: [
      { ref: "4.2.1", title: "Strong cryptography for data sent over open networks", checks: ["certificates-none-expiring", "certificates-endpoints-ok"] },
      { ref: "5.2.1", title: "Anti-malware is deployed", checks: ["malware-scanned", "malware-none-open"] },
      { ref: "6.2.4", title: "Software is built to prevent common attacks", checks: ["sast-no-critical", "secrets-none-open"] },
      { ref: "6.3.3", title: "Critical patches within one month", checks: ["vulns-no-critical", "vulns-no-kev"] },
      { ref: "6.4.2", title: "Public web applications are protected", checks: ["dast-targets", "dast-no-high"] },
      { ref: "8.4.2", title: "MFA for all access into the cardholder data environment", checks: [], manual: "The MFA coverage of people with access" },
      { ref: "10.2.1", title: "Audit logs are enabled", checks: ["logs-sources", "logs-store-up"] },
      { ref: "10.4.1", title: "Audit logs are reviewed", checks: ["siem-rules-enabled", "siem-rules-not-failing"] },
      { ref: "11.3.1", title: "Internal vulnerability scans", checks: ["vulns-assets", "vulns-feed-fresh"] },
      { ref: "11.5.1", title: "Intrusions are detected", checks: ["siem-rules-enabled", "deception-canaries"] },
      { ref: "12.6.1", title: "Security awareness program", checks: [], manual: "Training records of the last year" },
      { ref: "12.8.4", title: "Service providers' compliance is monitored", checks: ["risk-vendor-reviews"] },
      { ref: "12.10.1", title: "Incident response plan", checks: [], manual: "The incident response plan" },
    ],
  },
];

/** The expression a check stands for, as people read it, such as openasy_vulns_known_exploited = 0. */
export function expression(c: Check): string {
  const labels = c.match
    ? `{${Object.entries(c.match)
        .map(([k, v]) => `${k}=~"${v}"`)
        .join(",")}}`
    : "";
  const sel = `${c.agg && c.agg !== "sum" ? `${c.agg}(` : ""}${c.metric}${labels}${c.agg && c.agg !== "sum" ? ")" : ""}`;
  if (c.op === "within") return `time() - ${sel} <= ${c.value / DAY}d`;
  return `${sel} ${c.op === "eq" ? "=" : c.op === "le" ? "<=" : ">="} ${c.value}`;
}

/** Whether a value meets a check, now being a Unix time in seconds. */
export function passes(c: Check, value: number, now: number): boolean {
  if (c.op === "eq") return value === c.value;
  if (c.op === "le") return value <= c.value;
  if (c.op === "ge") return value >= c.value;
  return value > 0 && now - value <= c.value;
}
