import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { CHECKS, expression, FRAMEWORKS, passes, type Check, type Control, type Framework } from "./catalog.ts";
import { parseMetrics, select } from "./prom.ts";

export type ProblemCode = "invalid-token" | "invalid-json" | "invalid-body" | "not-found" | "conflict" | "not-configured" | "internal-error";

export class ComplianceError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  constructor(status: number, code: ProblemCode, detail: string) {
    super(detail);
    this.status = status;
    this.code = code;
  }
}

const bad = (detail: string) => new ComplianceError(422, "invalid-body", detail);
const notFound = (what: string) => new ComplianceError(404, "not-found", `${what} does not exist.`);

const DAY_MS = 86_400_000;
/** Days of history a check and a framework show. */
export const HISTORY_DAYS = 90;
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export type CheckState = "pass" | "fail" | "no-data" | "unreachable" | "not-connected";
export type ControlState = "passing" | "failing" | "needs-evidence" | "not-applicable";

export interface Source {
  product: string;
  url: string;
  state: "ok" | "failing" | "waiting";
  lastAt: string | null;
  lastOkAt: string | null;
  error: string | null;
  checks: number;
}

export interface CheckResult {
  id: string;
  product: string;
  title: string;
  expression: string;
  state: CheckState;
  value: number | null;
  at: string | null;
  /** The controls it proves, as framework and reference. */
  controls: Array<{ framework: string; ref: string }>;
}

export interface Gap {
  kind: "failing" | "no-data" | "unreachable" | "no-product" | "evidence-missing" | "evidence-expired";
  check?: string;
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

export interface ControlView {
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
  gaps: Gap[];
}

export interface ComplianceOptions {
  /** Each product read, and where its /metrics is. */
  sources: Array<{ product: string; url: string }>;
  clock?: () => number;
  fetch?: typeof fetch;
}

type Row = Record<string, SQLInputValue>;

export function createCompliance(db: DatabaseSync, { sources, clock = Date.now, fetch: http = fetch }: ComplianceOptions) {
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const today = () => iso().slice(0, 10);
  const connected = new Set(sources.map((s) => s.product));
  const checkById = new Map(CHECKS.map((c) => [c.id, c]));
  const usedBy = new Map<string, Array<{ framework: string; ref: string }>>();
  for (const f of FRAMEWORKS)
    for (const c of f.controls) for (const id of c.checks) usedBy.set(id, [...(usedBy.get(id) ?? []), { framework: f.id, ref: c.ref }]);

  function enabledFrameworks(): string[] {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'frameworks'").get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as string[]) : FRAMEWORKS.map((f) => f.id);
  }

  function framework(id: string): Framework {
    const f = FRAMEWORKS.find((x) => x.id === id);
    if (!f) throw notFound("The framework");
    return f;
  }

  function control(frameworkId: string, ref: string): { f: Framework; c: Control } {
    const f = framework(frameworkId);
    const c = f.controls.find((x) => x.ref === ref);
    if (!c) throw notFound("The control");
    return { f, c };
  }

  function sourceStates(): Map<string, Row> {
    return new Map((db.prepare("SELECT * FROM sources").all() as Row[]).map((r) => [r.product as string, r]));
  }

  /** Each check's state now: its last result, unless its product is not read or its last read failed. */
  function checkStates(): Map<string, { state: CheckState; value: number | null; at: string | null }> {
    const results = new Map((db.prepare("SELECT * FROM results").all() as Row[]).map((r) => [r.check_id as string, r]));
    const srcs = sourceStates();
    const out = new Map<string, { state: CheckState; value: number | null; at: string | null }>();
    for (const c of CHECKS) {
      const r = results.get(c.id);
      const value = r?.value === null || r?.value === undefined ? null : Number(r.value);
      const at = (r?.at as string | undefined) ?? null;
      const state: CheckState = !connected.has(c.product)
        ? "not-connected"
        : srcs.get(c.product)?.state !== "ok" || !r
          ? "unreachable"
          : (r.state as "pass" | "fail" | "no-data");
      out.set(c.id, { state, value, at });
    }
    return out;
  }

  function evidenceRows(frameworkId?: string, ref?: string): Evidence[] {
    const rows = (
      frameworkId
        ? db.prepare("SELECT * FROM evidence WHERE framework = ? AND ref = ? ORDER BY added_at DESC").all(frameworkId, ref!)
        : db.prepare("SELECT * FROM evidence ORDER BY added_at DESC").all()
    ) as Row[];
    const now = today();
    return rows.map((r) => ({
      id: r.id as string,
      framework: r.framework as string,
      ref: r.ref as string,
      title: r.title as string,
      url: r.url as string,
      note: r.note as string,
      validUntil: r.valid_until as string,
      valid: (r.valid_until as string) >= now,
      addedBy: r.added_by as string,
      addedAt: r.added_at as string,
    }));
  }

  function view(f: Framework, c: Control, states: ReturnType<typeof checkStates>, settings: Map<string, Row>, evidence: Evidence[]): ControlView {
    const s = settings.get(`${f.id} ${c.ref}`);
    const applicable = s ? s.applicable === 1 : true;
    const mine = evidence.filter((e) => e.framework === f.id && e.ref === c.ref);
    const valid = mine.some((e) => e.valid);
    const checks = c.checks.map((id) => ({ id, product: checkById.get(id)!.product, title: checkById.get(id)!.title, state: states.get(id)!.state }));
    const live = checks.filter((x) => x.state !== "not-connected");
    const gaps: Gap[] = [];
    for (const x of live)
      if (x.state === "fail" || x.state === "no-data" || x.state === "unreachable") gaps.push({ kind: x.state === "fail" ? "failing" : x.state, check: x.id });
    // Evidence by hand stands in for checks when no product of the install proves the control.
    if (c.manual || !live.length) {
      if (!valid) gaps.push({ kind: mine.length ? "evidence-expired" : !c.manual && !live.length && c.checks.length ? "no-product" : "evidence-missing" });
    }
    const state: ControlState = !applicable
      ? "not-applicable"
      : gaps.some((g) => g.kind === "failing")
        ? "failing"
        : gaps.length
          ? "needs-evidence"
          : "passing";
    return {
      framework: f.id,
      ref: c.ref,
      title: c.title,
      state,
      owner: (s?.owner as string | undefined) ?? "",
      applicable,
      reason: (s?.reason as string | undefined) ?? "",
      manual: c.manual ?? null,
      checks,
      evidence: mine.length,
      gaps: applicable ? gaps : [],
    };
  }

  function allControls(): ControlView[] {
    const states = checkStates();
    const settings = new Map((db.prepare("SELECT * FROM controls").all() as Row[]).map((r) => [`${r.framework as string} ${r.ref as string}`, r]));
    const evidence = evidenceRows();
    return FRAMEWORKS.flatMap((f) => f.controls.map((c) => view(f, c, states, settings, evidence)));
  }

  function tally(controls: ControlView[]) {
    const n = (s: ControlState) => controls.filter((c) => c.state === s).length;
    return { controls: controls.length, passing: n("passing"), failing: n("failing"), needsEvidence: n("needs-evidence"), notApplicable: n("not-applicable") };
  }

  /** Keeps today's share of passing controls for each framework, for the trend. */
  function recordDay() {
    const controls = allControls();
    for (const f of FRAMEWORKS) {
      const t = tally(controls.filter((c) => c.framework === f.id));
      db.prepare(
        "INSERT INTO framework_days (framework, day, passing, total) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET passing = excluded.passing, total = excluded.total",
      ).run(f.id, today(), t.passing, t.controls - t.notApplicable);
    }
  }

  function checkResult(c: Check, states: ReturnType<typeof checkStates>): CheckResult {
    const s = states.get(c.id)!;
    return {
      id: c.id,
      product: c.product,
      title: c.title,
      expression: expression(c),
      state: s.state,
      value: s.value,
      at: s.at,
      controls: usedBy.get(c.id) ?? [],
    };
  }

  return {
    // ---------------------------------------------------------------- collection

    /** Reads every product's /metrics once, and keeps each check's result and the day's tally. */
    async collect(): Promise<Source[]> {
      for (const src of sources) {
        const at = iso();
        let text: string;
        try {
          const res = await http(src.url, { headers: { "user-agent": "openasy-compliance", accept: "text/plain" }, signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`${src.url} answered ${res.status}.`);
          text = await res.text();
        } catch (err) {
          // fetch says only "fetch failed"; why is in its cause, such as ECONNREFUSED or a certificate it does not trust.
          const cause = (err as { cause?: { code?: string; message?: string } }).cause;
          const message = err instanceof Error && err.name !== "Error" ? `${src.url}: ${cause?.code ?? cause?.message ?? err.message}` : (err as Error).message;
          db.prepare(
            "INSERT INTO sources (product, url, state, last_at, error) VALUES (?, ?, 'failing', ?, ?) ON CONFLICT DO UPDATE SET url = excluded.url, state = 'failing', last_at = excluded.last_at, error = excluded.error",
          ).run(src.product, src.url, at, message.slice(0, 300));
          continue;
        }
        const samples = parseMetrics(text);
        const now = clock() / 1000;
        db.exec("BEGIN");
        try {
          for (const c of CHECKS.filter((x) => x.product === src.product)) {
            const value = select(samples, c.metric, c.match, c.agg);
            const state = value === undefined ? "no-data" : passes(c, value, now) ? "pass" : "fail";
            db.prepare(
              "INSERT INTO results (check_id, value, state, at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value, state = excluded.state, at = excluded.at",
            ).run(c.id, value ?? null, state, at);
            if (value !== undefined)
              db.prepare(
                "INSERT INTO check_days (check_id, day, runs, passes, last_value) VALUES (?, ?, 1, ?, ?) ON CONFLICT DO UPDATE SET runs = runs + 1, passes = passes + excluded.passes, last_value = excluded.last_value",
              ).run(c.id, at.slice(0, 10), state === "pass" ? 1 : 0, value);
          }
          db.prepare(
            "INSERT INTO sources (product, url, state, last_at, last_ok_at, error) VALUES (?, ?, 'ok', ?, ?, NULL) ON CONFLICT DO UPDATE SET url = excluded.url, state = 'ok', last_at = excluded.last_at, last_ok_at = excluded.last_ok_at, error = NULL",
          ).run(src.product, src.url, at, at);
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      }
      recordDay();
      return this.sources();
    },

    sources(): Source[] {
      const states = sourceStates();
      return sources.map((s) => {
        const r = states.get(s.product);
        return {
          product: s.product,
          url: s.url,
          state: r ? (r.state as "ok" | "failing") : "waiting",
          lastAt: (r?.last_at as string | undefined) ?? null,
          lastOkAt: (r?.last_ok_at as string | undefined) ?? null,
          error: (r?.error as string | undefined) ?? null,
          checks: CHECKS.filter((c) => c.product === s.product).length,
        };
      });
    },

    checks(): CheckResult[] {
      const states = checkStates();
      return CHECKS.map((c) => checkResult(c, states));
    },

    /** A check with its days: how many reads passed each day, the evidence of a period. */
    check(id: string): CheckResult & { days: Array<{ day: string; runs: number; passes: number; value: number }> } {
      const c = checkById.get(id);
      if (!c) throw notFound("The check");
      const since = iso(clock() - HISTORY_DAYS * DAY_MS).slice(0, 10);
      const days = (
        db.prepare("SELECT day, runs, passes, last_value FROM check_days WHERE check_id = ? AND day >= ? ORDER BY day").all(id, since) as Row[]
      ).map((r) => ({
        day: r.day as string,
        runs: Number(r.runs),
        passes: Number(r.passes),
        value: Number(r.last_value),
      }));
      return { ...checkResult(c, checkStates()), days };
    },

    // ---------------------------------------------------------------- frameworks and controls

    frameworks() {
      const controls = allControls();
      const enabled = enabledFrameworks();
      const since = iso(clock() - HISTORY_DAYS * DAY_MS).slice(0, 10);
      return FRAMEWORKS.map((f) => ({
        id: f.id,
        name: f.name,
        enabled: enabled.includes(f.id),
        ...tally(controls.filter((c) => c.framework === f.id)),
        days: (db.prepare("SELECT day, passing, total FROM framework_days WHERE framework = ? AND day >= ? ORDER BY day").all(f.id, since) as Row[]).map(
          (r) => ({
            day: r.day as string,
            passing: Number(r.passing),
            total: Number(r.total),
          }),
        ),
      }));
    },

    setFramework(id: string, body: Record<string, unknown>) {
      framework(id);
      if (typeof body.enabled !== "boolean") throw bad("enabled must be true or false.");
      const set = new Set(enabledFrameworks());
      if (body.enabled) set.add(id);
      else set.delete(id);
      db.prepare("INSERT INTO settings (key, value) VALUES ('frameworks', ?) ON CONFLICT DO UPDATE SET value = excluded.value").run(
        JSON.stringify(FRAMEWORKS.map((f) => f.id).filter((x) => set.has(x))),
      );
      return this.frameworks().find((f) => f.id === id)!;
    },

    controls(filter: { framework?: string | null; state?: string | null; q?: string | null } = {}): ControlView[] {
      if (filter.framework) framework(filter.framework);
      if (filter.state && !["passing", "failing", "needs-evidence", "not-applicable"].includes(filter.state))
        throw bad("state is passing, failing, needs-evidence or not-applicable.");
      const enabled = enabledFrameworks();
      const q = filter.q?.trim().toLowerCase();
      return allControls().filter(
        (c) =>
          (filter.framework ? c.framework === filter.framework : enabled.includes(c.framework)) &&
          (!filter.state || c.state === filter.state) &&
          (!q || [c.ref, c.title, c.owner].some((x) => x.toLowerCase().includes(q))),
      );
    },

    control(frameworkId: string, ref: string) {
      const { f, c } = control(frameworkId, ref);
      const states = checkStates();
      const settings = new Map(
        (db.prepare("SELECT * FROM controls WHERE framework = ? AND ref = ?").all(f.id, c.ref) as Row[]).map((r) => [`${f.id} ${c.ref}`, r]),
      );
      const evidence = evidenceRows(f.id, c.ref);
      return {
        ...view(f, c, states, settings, evidence),
        frameworkName: f.name,
        results: c.checks.map((id) => checkResult(checkById.get(id)!, states)),
        evidenceItems: evidence,
      };
    },

    /** Who owns a control, and whether it applies here; one that does not needs a reason, as a statement of applicability does. */
    updateControl(frameworkId: string, ref: string, body: Record<string, unknown>) {
      const { f, c } = control(frameworkId, ref);
      const cur = db.prepare("SELECT * FROM controls WHERE framework = ? AND ref = ?").get(f.id, c.ref) as Row | undefined;
      let owner = (cur?.owner as string | undefined) ?? "";
      let applicable = cur ? cur.applicable === 1 : true;
      let reason = (cur?.reason as string | undefined) ?? "";
      if (body.owner !== undefined) {
        if (typeof body.owner !== "string" || body.owner.length > 120) throw bad("owner is text of at most 120 characters.");
        owner = body.owner.trim();
      }
      if (body.applicable !== undefined) {
        if (typeof body.applicable !== "boolean") throw bad("applicable must be true or false.");
        applicable = body.applicable;
      }
      if (body.reason !== undefined) {
        if (typeof body.reason !== "string" || body.reason.length > 500) throw bad("reason is text of at most 500 characters.");
        reason = body.reason.trim();
      }
      if (body.owner === undefined && body.applicable === undefined && body.reason === undefined)
        throw bad("Send at least one of owner, applicable and reason.");
      if (!applicable && !reason) throw bad("Say why the control does not apply: an auditor will ask.");
      if (applicable) reason = "";
      db.prepare(
        "INSERT INTO controls (framework, ref, owner, applicable, reason) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET owner = excluded.owner, applicable = excluded.applicable, reason = excluded.reason",
      ).run(f.id, c.ref, owner, applicable ? 1 : 0, reason);
      recordDay();
      return this.control(f.id, c.ref);
    },

    // ---------------------------------------------------------------- evidence by hand

    addEvidence(frameworkId: string, ref: string, body: Record<string, unknown>, actor: string): Evidence {
      const { f, c } = control(frameworkId, ref);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > 200) throw bad("title is required, at most 200 characters.");
      const url = body.url === undefined || body.url === "" ? "" : body.url;
      if (typeof url !== "string" || (url && (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol))))
        throw bad("url must be an http(s) address, such as the document in your wiki.");
      const note = body.note === undefined ? "" : body.note;
      if (typeof note !== "string" || note.length > 2000) throw bad("note is text of at most 2000 characters.");
      const validUntil = body.validUntil ?? iso(clock() + 365 * DAY_MS).slice(0, 10);
      if (!isDay(validUntil)) throw bad("validUntil is a day, such as 2027-10-28.");
      if (validUntil < today()) throw bad("validUntil has passed: evidence must still be valid.");
      const id = `ev_${randomUUID().slice(0, 12)}`;
      db.prepare("INSERT INTO evidence (id, framework, ref, title, url, note, valid_until, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        id,
        f.id,
        c.ref,
        title,
        url,
        note.trim(),
        validUntil,
        actor,
        iso(),
      );
      recordDay();
      return evidenceRows(f.id, c.ref).find((e) => e.id === id)!;
    },

    deleteEvidence(id: string): void {
      if (!db.prepare("DELETE FROM evidence WHERE id = ?").run(id).changes) throw notFound("The evidence");
      recordDay();
    },

    // ---------------------------------------------------------------- overview and reports

    summary() {
      const frameworks = this.frameworks().filter((f) => f.enabled);
      const controls = this.controls();
      const srcs = this.sources();
      const soon = iso(clock() + 30 * DAY_MS).slice(0, 10);
      const evidence = evidenceRows();
      const last = db.prepare("SELECT MAX(last_at) AS at FROM sources").get() as { at: string | null };
      const failing = new Map<string, number>();
      for (const c of controls) for (const g of c.gaps) if (g.kind === "failing" && g.check) failing.set(g.check, (failing.get(g.check) ?? 0) + 1);
      return {
        frameworks,
        totals: tally(controls),
        withoutOwner: controls.filter((c) => c.applicable && !c.owner).length,
        sources: { total: srcs.length, ok: srcs.filter((s) => s.state === "ok").length, failing: srcs.filter((s) => s.state === "failing").length },
        evidence: {
          total: evidence.length,
          expiringSoon: evidence.filter((e) => e.valid && e.validUntil <= soon).length,
          expired: evidence.filter((e) => !e.valid).length,
        },
        failingChecks: [...failing]
          .sort((a, b) => b[1] - a[1])
          .map(([id, controls]) => ({ id, title: checkById.get(id)!.title, product: checkById.get(id)!.product, controls })),
        lastCollectedAt: last.at,
      };
    },

    /** Every control of a framework with its state and evidence, as Markdown or CSV to hand to an auditor. */
    report(frameworkId: string, format: string): { type: string; file: string; body: string } {
      const f = framework(frameworkId);
      if (format !== "md" && format !== "csv") throw bad("format is md or csv.");
      const controls = this.controls({ framework: f.id });
      const states = checkStates();
      const evidence = evidenceRows();
      const day = today();
      const file = `${f.id}-${day}.${format}`;
      if (format === "csv") {
        const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        const lines = [["control", "title", "state", "owner", "checks", "evidence", "not applicable because"].join(",")];
        for (const c of controls)
          lines.push(
            [
              c.ref,
              c.title,
              c.state,
              c.owner,
              c.checks.map((x) => `${x.title}: ${x.state}`).join("; "),
              evidence
                .filter((e) => e.framework === f.id && e.ref === c.ref && e.valid)
                .map((e) => `${e.title}${e.url ? ` (${e.url})` : ""}, valid until ${e.validUntil}`)
                .join("; "),
              c.reason,
            ]
              .map((v) => cell(String(v)))
              .join(","),
          );
        return { type: "text/csv; charset=utf-8", file, body: lines.join("\n") + "\n" };
      }
      const t = tally(controls);
      const out = [
        `# ${f.name}: controls on ${day}`,
        "",
        `${t.passing} of ${t.controls - t.notApplicable} controls that apply are passing; ${t.failing} failing, ${t.needsEvidence} need evidence, ${t.notApplicable} do not apply.`,
        "",
        "Checks read the products' own numbers when this report was made; evidence added by hand counts until its date.",
        "",
      ];
      for (const c of controls) {
        out.push(`## ${c.ref} ${c.title}`, "", `- State: ${c.state}`, `- Owner: ${c.owner || "none"}`);
        if (!c.applicable) out.push(`- Does not apply: ${c.reason}`);
        for (const x of c.checks) {
          const s = states.get(x.id)!;
          out.push(`- Check, ${x.product}: ${x.title}: ${x.state}${s.value !== null ? ` (value ${s.value}, read ${s.at})` : ""}`);
        }
        for (const e of evidence.filter((e) => e.framework === f.id && e.ref === c.ref))
          out.push(
            `- Evidence: ${e.title}${e.url ? `, ${e.url}` : ""}, added by ${e.addedBy} on ${e.addedAt.slice(0, 10)}, ${e.valid ? "valid" : "expired"} until ${e.validUntil}`,
          );
        out.push("");
      }
      return { type: "text/markdown; charset=utf-8", file, body: out.join("\n") };
    },

    gauges() {
      const controls = this.controls();
      return {
        controls: (["passing", "failing", "needs-evidence", "not-applicable"] as const).map((state) => ({
          state,
          n: controls.filter((c) => c.state === state).length,
        })),
        sourcesFailing: this.sources().filter((s) => s.state === "failing").length,
      };
    },

    /** Days of check history older than a year are deleted; evidence by hand stays until someone deletes it. */
    purge(): number {
      const before = iso(clock() - 400 * DAY_MS).slice(0, 10);
      return (
        Number(db.prepare("DELETE FROM check_days WHERE day < ?").run(before).changes) +
        Number(db.prepare("DELETE FROM framework_days WHERE day < ?").run(before).changes)
      );
    },
  };
}

export type Compliance = ReturnType<typeof createCompliance>;
