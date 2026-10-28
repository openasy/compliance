// The UI is an ordinary client of the public API (ADR 0014, 0018). Types follow openapi.json.

export type CheckState = "pass" | "fail" | "no-data" | "unreachable" | "not-connected";
export type ControlState = "passing" | "failing" | "needs-evidence" | "not-applicable";
export type GapKind = "failing" | "no-data" | "unreachable" | "no-product" | "evidence-missing" | "evidence-expired";

/** Another OpenAsy product of this install, from OPENASY_PRODUCTS. */
export interface ProductLink {
  id: string;
  url: string;
}

export interface Tally {
  controls: number;
  passing: number;
  failing: number;
  needsEvidence: number;
  notApplicable: number;
}

export interface Framework extends Tally {
  id: string;
  name: string;
  enabled: boolean;
  days: Array<{ day: string; passing: number; total: number }>;
}

export interface ControlSummary {
  framework: string;
  ref: string;
  title: string;
  state: ControlState;
  owner: string;
  applicable: boolean;
  reason: string;
  manual: string | null;
  checks: Array<{ id: string; product: string; title: string; state: CheckState }>;
  evidence: number;
  gaps: Array<{ kind: GapKind; check?: string }>;
}

export interface Check {
  id: string;
  product: string;
  title: string;
  expression: string;
  state: CheckState;
  value: number | null;
  at: string | null;
  controls: Array<{ framework: string; ref: string }>;
}

export interface CheckDetail extends Check {
  days: Array<{ day: string; runs: number; passes: number; value: number }>;
}

export interface Evidence {
  id: string;
  framework: string;
  ref: string;
  title: string;
  url: string;
  note: string;
  validUntil: string;
  valid: boolean;
  addedBy: string;
  addedAt: string;
}

export interface Control extends ControlSummary {
  frameworkName: string;
  results: Check[];
  evidenceItems: Evidence[];
}

export interface Source {
  product: string;
  url: string;
  state: "ok" | "failing" | "waiting";
  lastAt: string | null;
  lastOkAt: string | null;
  error: string | null;
  checks: number;
}

export interface Summary {
  frameworks: Framework[];
  totals: Tally;
  withoutOwner: number;
  sources: { total: number; ok: number; failing: number };
  evidence: { total: number; expiringSoon: number; expired: number };
  failingChecks: Array<{ id: string; title: string; product: string; controls: number }>;
  lastCollectedAt: string | null;
}

export class Unauthorized extends Error {}
/** The signed-in owner or admin has no second factor yet; the sign-in gate asks for one. */
export class MfaSetupRequired extends Error {}
export class ApiError extends Error {}

// The session is an HttpOnly cookie set by sign-in (@openasy/auth); the browser sends it, nothing is stored here.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { code?: string; detail?: string };
    if (res.status === 401) throw new Unauthorized(problem.detail);
    if (problem.code === "mfa-setup-required") throw new MfaSetupRequired(problem.detail);
    throw new ApiError(problem.detail ?? `${path}: ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
