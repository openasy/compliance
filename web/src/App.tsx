import {
  AppShell,
  Badge,
  BarList,
  BrandProvider,
  Button,
  Callout,
  DataTable,
  EmptyState,
  FacetFilter,
  FilterBar,
  Gauge,
  KpiCard,
  KpiGrid,
  navigate,
  OverviewGrid,
  PageHeader,
  Panel,
  PRODUCT_IDS,
  PRODUCTS,
  SearchInput,
  SegmentedControl,
  StatusBadge,
  StatusStrip,
  Switch,
  TextField,
  TimeSeriesChart,
  toLocale,
  TONE_COLORS,
  useLocalePreference,
  usePath,
  useThemePreference,
  type Column,
  type ProductId,
  type Tone,
} from "@openasy/ui";
import { AccountSettings, AuthGate, MembersSettings, SignInSettings, TokensSettings, useAccountMenu, useAuth, useInstallBrand } from "@openasy/auth/react";
import colophon from "virtual:openasy-colophon";
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Download,
  FileCheck2,
  KeyRound,
  LayoutDashboard,
  Library,
  LogIn,
  LogOut,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  UserX,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  api,
  MfaSetupRequired,
  Unauthorized,
  type Check,
  type CheckDetail,
  type CheckState,
  type Control,
  type ControlState,
  type ControlSummary,
  type Framework,
  type ProductLink,
  type Source,
  type Summary,
} from "./api.ts";
import { useT } from "./i18n.ts";
import { search } from "./search.ts";

const PAGES = ["controls", "checks", "frameworks", "account", "members", "signin", "tokens", "about"] as const;
type Route = { page: "overview" | (typeof PAGES)[number] } | { page: "control"; framework: string; ref: string } | { page: "check"; id: string };
/** The first path segments that are pages of this UI, for followLinks. */
export const PATHS = ["overview", ...PAGES];
function parseRoute(path: string): Route {
  const [page, a, b] = path.replace(/^\//, "").split("/");
  if (page === "controls" && a && b) return { page: "control", framework: decodeURIComponent(a), ref: decodeURIComponent(b) };
  if (page === "checks" && a) return { page: "check", id: decodeURIComponent(a) };
  if ((PAGES as readonly string[]).includes(page ?? "")) return { page: page as (typeof PAGES)[number] };
  return { page: "overview" };
}

/** A query parameter of the address, such as the framework a list is narrowed to. */
const param = (name: string) => new URLSearchParams(window.location.search).get(name);

/** Data loading with the session; when it ends, the sign-in screen comes back. */
function useApi() {
  const { expired, refresh } = useAuth();
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      try {
        return await api<T>(path, init);
      } catch (err) {
        if (err instanceof Unauthorized) expired();
        if (err instanceof MfaSetupRequired) void refresh();
        throw err;
      }
    },
    [expired, refresh],
  );
}
type Call = ReturnType<typeof useApi>;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const controlPath = (framework: string, ref: string) => `/controls/${framework}/${encodeURIComponent(ref)}`;
const productName = (id: string) => (PRODUCTS as Record<string, { name: string } | undefined>)[id]?.name ?? id;

const CONTROL_TONE: Record<ControlState, Tone> = { passing: "success", failing: "danger", "needs-evidence": "warning", "not-applicable": "neutral" };
const CHECK_TONE: Record<CheckState, Tone> = { pass: "success", fail: "danger", "no-data": "warning", unreachable: "warning", "not-connected": "neutral" };

function ControlBadge({ state }: { state: ControlState }) {
  const t = useT();
  return <StatusBadge tone={CONTROL_TONE[state]}>{t(`controlStates.${state}`)}</StatusBadge>;
}

function CheckBadge({ state }: { state: CheckState }) {
  const t = useT();
  return <StatusBadge tone={CHECK_TONE[state]}>{t(`checkStates.${state}`)}</StatusBadge>;
}

/** Downloads a framework's report: the API answers a file, which the browser saves. */
function ReportButtons({ framework }: { framework: string }) {
  const t = useT();
  return (
    <span className="flex flex-wrap gap-1.5">
      {(["md", "csv"] as const).map((f) => (
        <Button key={f} size="sm" icon={<Download />} onClick={() => window.location.assign(`/api/v1/frameworks/${framework}/report?format=${f}`)}>
          {t(`reports.${f}`)}
        </Button>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- Overview

function OverviewPage({ summary }: { summary: Summary }) {
  const t = useT();
  const s = summary;
  const applies = s.totals.controls - s.totals.notApplicable;
  const days = s.frameworks[0]?.days ?? [];
  return (
    <>
      <PageHeader
        title={t("overviewPage.overview")}
        description={s.lastCollectedAt ? t("overviewPage.readAt", { when: when(s.lastCollectedAt) }) : t("overviewPage.notReadYet")}
      />
      {s.sources.failing > 0 && (
        <Callout
          tone="warning"
          title={t("overviewPage.sourcesFailing", { count: s.sources.failing })}
          action={
            <Button size="sm" onClick={() => navigate("/checks")}>
              {t("overviewPage.see")}
            </Button>
          }
        >
          {t("overviewPage.sourcesFailingDetail")}
        </Callout>
      )}
      {s.sources.total === 0 && <Callout title={t("overviewPage.noSources")}>{t("overviewPage.noSourcesDetail")}</Callout>}
      <KpiGrid minWidth={150}>
        <KpiCard
          label={t("overviewPage.passing")}
          value={`${pct(s.totals.passing, applies)}%`}
          unit={t("overviewPage.ofApply", { n: s.totals.passing, of: applies })}
          icon={CircleCheck}
          tone="success"
          href="/controls?state=passing"
        />
        <KpiCard
          label={t("overviewPage.failing")}
          value={s.totals.failing}
          icon={CircleX}
          tone={s.totals.failing ? "danger" : "success"}
          href="/controls?state=failing"
        />
        <KpiCard
          label={t("overviewPage.needsEvidence")}
          value={s.totals.needsEvidence}
          icon={CircleAlert}
          tone={s.totals.needsEvidence ? "warning" : "success"}
          href="/controls?state=needs-evidence"
        />
        <KpiCard label={t("overviewPage.withoutOwner")} value={s.withoutOwner} icon={UserX} tone={s.withoutOwner ? "info" : "success"} href="/controls" />
        <KpiCard
          label={t("overviewPage.productsRead")}
          value={`${s.sources.ok}/${s.sources.total}`}
          icon={Plug}
          tone={s.sources.failing ? "warning" : "success"}
          href="/checks"
        />
      </KpiGrid>
      <OverviewGrid layout={s.frameworks.length > 2 ? "halves" : "main-side"}>
        {s.frameworks.map((f) => {
          const of = f.controls - f.notApplicable;
          return (
            <Panel
              key={f.id}
              title={f.name}
              description={t("overviewPage.frameworkDetail", { failing: f.failing, needs: f.needsEvidence, na: f.notApplicable })}
              actions={<ReportButtons framework={f.id} />}
            >
              <div className="flex flex-wrap items-center gap-4">
                <Gauge
                  label={f.name}
                  value={pct(f.passing, of)}
                  display={`${pct(f.passing, of)}%`}
                  tone={f.failing ? "danger" : f.needsEvidence ? "warning" : "success"}
                  caption={t("overviewPage.ofApply", { n: f.passing, of })}
                  size={150}
                />
                <Button onClick={() => navigate(`/controls?framework=${f.id}`)}>{t("overviewPage.controls")}</Button>
              </div>
            </Panel>
          );
        })}
      </OverviewGrid>
      <OverviewGrid>
        <Panel title={t("overviewPage.trend")} description={t("overviewPage.trendDetail")}>
          {days.length > 1 ? (
            <TimeSeriesChart
              label={t("overviewPage.trend")}
              labels={days.map((d) => day(d.day))}
              height={200}
              yMax={100}
              format={(v) => `${Math.round(v)}%`}
              threshold={{ value: 80, label: t("overviewPage.target") }}
              series={s.frameworks.map((f) => ({
                id: f.id,
                name: f.name,
                data: days.map((d) => {
                  const x = f.days.find((y) => y.day === d.day);
                  return x ? pct(x.passing, x.total) : 0;
                }),
              }))}
            />
          ) : (
            <EmptyState title={t("overviewPage.trendSoon")}>{t("overviewPage.trendSoonDetail")}</EmptyState>
          )}
        </Panel>
        <Panel title={t("overviewPage.holdingBack")} description={t("overviewPage.holdingBackDetail")}>
          {s.failingChecks.length ? (
            <BarList
              label={t("overviewPage.holdingBack")}
              items={s.failingChecks
                .slice(0, 8)
                .map((c) => ({ id: c.id, label: c.title, value: c.controls, href: `/checks/${c.id}`, color: TONE_COLORS.danger }))}
            />
          ) : (
            <EmptyState title={t("overviewPage.noFailingChecks")} />
          )}
        </Panel>
      </OverviewGrid>
      {(s.evidence.expiringSoon > 0 || s.evidence.expired > 0) && (
        <Callout tone="info" title={t("overviewPage.evidenceEnding", { soon: s.evidence.expiringSoon, expired: s.evidence.expired })}>
          {t("overviewPage.evidenceEndingDetail")}
        </Callout>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Controls

function ControlsPage({ call, frameworks }: { call: Call; frameworks: Framework[] }) {
  const t = useT();
  const [controls, setControls] = useState<ControlSummary[]>();
  const [fw, setFw] = useState<string[]>(() => (param("framework") ? [param("framework")!] : []));
  const [state, setState] = useState<ControlState | "all">(() => (param("state") as ControlState | null) ?? "all");
  const [q, setQ] = useState("");
  useEffect(() => {
    void call<{ controls: ControlSummary[] }>("/api/v1/controls").then(
      (r) => setControls(r.controls),
      () => setControls([]),
    );
  }, [call]);
  const query = q.trim().toLowerCase();
  const byFw = (controls ?? []).filter((c) => !fw.length || fw.includes(c.framework));
  const rows = byFw.filter((c) => (state === "all" || c.state === state) && (!query || [c.ref, c.title, c.owner].some((x) => x.toLowerCase().includes(query))));
  const name = (id: string) => frameworks.find((f) => f.id === id)?.name ?? id;
  const columns: Column<ControlSummary>[] = [
    {
      id: "ref",
      header: t("controlsPage.control"),
      width: "34%",
      sortValue: (c) => `${c.framework} ${c.ref}`,
      cell: (c) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            <span className="font-mono text-xs">{c.ref}</span> {c.title}
          </span>
          <span className="text-2xs text-fg-muted">{name(c.framework)}</span>
        </span>
      ),
    },
    { id: "state", header: t("controlsPage.state"), width: "140px", sortValue: (c) => c.state, cell: (c) => <ControlBadge state={c.state} /> },
    {
      id: "proof",
      header: t("controlsPage.proof"),
      cell: (c) => {
        const live = c.checks.filter((x) => x.state !== "not-connected");
        return (
          <span className="flex flex-col text-xs">
            {live.length ? (
              <span>{t("controlsPage.checksPassing", { n: live.filter((x) => x.state === "pass").length, of: live.length })}</span>
            ) : (
              c.checks.length > 0 && <span className="text-fg-muted">{t("controlsPage.noProduct")}</span>
            )}
            {(c.manual || c.evidence > 0) && <span className="text-fg-muted">{t("controlsPage.evidence", { count: c.evidence })}</span>}
          </span>
        );
      },
    },
    {
      id: "owner",
      header: t("controlsPage.owner"),
      width: "160px",
      sortValue: (c) => c.owner,
      cell: (c) => c.owner || <span className="text-fg-muted">–</span>,
    },
  ];
  return (
    <>
      <PageHeader
        title={t("controlsPage.controls")}
        description={t("controlsPage.description")}
        actions={
          <SegmentedControl
            label={t("controlsPage.state")}
            value={state}
            onChange={setState}
            options={[
              { value: "all", label: t("controlsPage.all") },
              ...(["failing", "needs-evidence", "passing", "not-applicable"] as const).map((s) => ({
                value: s,
                label: `${t(`controlStates.${s}`)} ${byFw.filter((c) => c.state === s).length}`,
              })),
            ]}
          />
        }
      />
      <Panel title={t("controlsPage.controls")} description={t("controlsPage.shown", { shown: rows.length, total: controls?.length ?? 0 })} flush>
        <div className="border-b border-line px-3 py-2">
          <FilterBar onClear={fw.length || q ? () => (setFw([]), setQ("")) : undefined}>
            <FacetFilter
              label={t("controlsPage.framework")}
              selected={fw}
              onChange={setFw}
              options={frameworks
                .filter((f) => f.enabled)
                .map((f) => ({ value: f.id, label: f.name, count: controls?.filter((c) => c.framework === f.id).length }))}
            />
            <SearchInput label={t("controlsPage.search")} className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
          </FilterBar>
        </div>
        <DataTable
          label={t("controlsPage.controls")}
          columns={columns}
          rows={rows}
          loading={!controls}
          getRowId={(c) => `${c.framework} ${c.ref}`}
          onRowClick={(c) => navigate(controlPath(c.framework, c.ref))}
          minWidth={820}
          empty={<EmptyState title={t("controlsPage.none")}>{t("controlsPage.noneDetail")}</EmptyState>}
        />
      </Panel>
    </>
  );
}

function ControlPage({ call, framework, reference, reload }: { call: Call; framework: string; reference: string; reload: () => void }) {
  const t = useT();
  const { can } = useAuth();
  const editor = can("editor");
  const [c, setC] = useState<Control | null>();
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [until, setUntil] = useState("");
  const [evError, setEvError] = useState<string>();
  const path = `/api/v1/controls/${encodeURIComponent(framework)}/${encodeURIComponent(reference)}`;
  const take = (x: Control) => (setC(x), setOwner(x.owner), setReason(x.reason));
  const load = useCallback(() => void call<Control>(path).then(take, () => setC(null)), [call, path]);
  useEffect(load, [load]);
  const patch = async (body: Record<string, unknown>) => {
    try {
      take(await call<Control>(path, { method: "PATCH", body: JSON.stringify(body) }));
      setError(undefined);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await call(`${path}/evidence`, { method: "POST", body: JSON.stringify({ title: title.trim(), url: link.trim(), ...(until && { validUntil: until }) }) });
      setTitle("");
      setLink("");
      setUntil("");
      setEvError(undefined);
      load();
      reload();
    } catch (err) {
      setEvError((err as Error).message);
    }
  };
  if (c === null)
    return (
      <EmptyState title={t("controlPage.notFound")} action={<Button onClick={() => navigate("/controls")}>{t("controlPage.back")}</Button>}>
        {t("controlPage.notFoundDetail")}
      </EmptyState>
    );
  if (!c) return <EmptyState title={t("product.loading")} icon={<ShieldCheck />} />;
  const checkColumns: Column<Check>[] = [
    { id: "product", header: t("checksPage.product"), width: "130px", cell: (x) => <Badge>{productName(x.product)}</Badge> },
    {
      id: "check",
      header: t("checksPage.check"),
      cell: (x) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{x.title}</span>
          <span className="compliance-clamp font-mono text-2xs text-fg-muted" title={x.expression}>
            {x.expression}
          </span>
        </span>
      ),
    },
    { id: "value", header: t("checksPage.value"), width: "100px", align: "right", mono: true, cell: (x) => (x.value === null ? "–" : x.value) },
    { id: "state", header: t("checksPage.state"), width: "130px", cell: (x) => <CheckBadge state={x.state} /> },
  ];
  return (
    <>
      <PageHeader
        title={`${c.ref} ${c.title}`}
        breadcrumbs={[
          { label: t("controlsPage.controls"), href: "/controls" },
          { label: c.frameworkName, href: `/controls?framework=${c.framework}` },
          { label: c.ref },
        ]}
        meta={<ControlBadge state={c.state} />}
      />
      {c.gaps.length > 0 && (
        <Callout tone={c.state === "failing" ? "danger" : "warning"} title={t("controlPage.whatIsMissing")}>
          <ul className="compliance-list flex flex-col gap-0.5">
            {c.gaps.map((g, i) => (
              <li key={i}>{t(`gaps.${g.kind}`, { check: c.checks.find((x) => x.id === g.check)?.title ?? "", manual: c.manual ?? "" })}</li>
            ))}
          </ul>
        </Callout>
      )}
      <Panel title={t("controlPage.checks")} description={t("controlPage.checksDetail")} flush>
        <DataTable
          label={t("controlPage.checks")}
          columns={checkColumns}
          rows={c.results}
          getRowId={(x) => x.id}
          onRowClick={(x) => navigate(`/checks/${x.id}`)}
          minWidth={680}
          empty={<EmptyState title={t("controlPage.noChecks")}>{t("controlPage.noChecksDetail")}</EmptyState>}
        />
      </Panel>
      <OverviewGrid>
        <Panel title={t("controlPage.evidence")} description={c.manual ? t("controlPage.asks", { manual: c.manual }) : t("controlPage.evidenceDetail")}>
          {c.evidenceItems.length ? (
            <ul className="compliance-list flex flex-col gap-2">
              {c.evidenceItems.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{e.url ? <a href={e.url}>{e.title}</a> : e.title}</span>
                    <span className="text-xs text-fg-muted">{t("controlPage.addedBy", { who: e.addedBy, when: when(e.addedAt), until: e.validUntil })}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusBadge tone={e.valid ? "success" : "danger"}>{e.valid ? t("controlPage.valid") : t("controlPage.expired")}</StatusBadge>
                    {editor && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<Trash2 />}
                        aria-label={t("controlPage.deleteEvidence", { title: e.title })}
                        onClick={() => void call(`/api/v1/evidence/${e.id}`, { method: "DELETE" }).then(() => (load(), reload()))}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-fg-muted">{t("controlPage.noEvidence")}</p>
          )}
          {editor && (
            <form className="mt-3 flex flex-col gap-2 border-t border-line pt-3" onSubmit={add} aria-label={t("controlPage.addEvidence")}>
              <TextField
                label={t("controlPage.title")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={c.manual ?? t("controlPage.titlePlaceholder")}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField label={t("controlPage.link")} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://wiki.example.com/…" />
                <TextField
                  label={t("controlPage.validUntil")}
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  hint={t("controlPage.validUntilHint")}
                  error={evError}
                />
              </div>
              <div>
                <Button type="submit" size="sm" variant="primary" disabled={!title.trim()}>
                  {t("controlPage.addEvidence")}
                </Button>
              </div>
            </form>
          )}
        </Panel>
        <Panel title={t("controlPage.ownerAndScope")}>
          <div className="flex flex-col gap-2.5">
            <TextField
              label={t("controlsPage.owner")}
              value={owner}
              disabled={!editor}
              onChange={(e) => setOwner(e.target.value)}
              placeholder={t("controlPage.ownerPlaceholder")}
            />
            {editor && (
              <div>
                <Button size="sm" disabled={owner === c.owner} onClick={() => void patch({ owner })}>
                  {t("controlPage.save")}
                </Button>
              </div>
            )}
            <Switch
              checked={c.applicable}
              disabled={!editor || (c.applicable && !reason.trim())}
              onCheckedChange={(v) => void patch(v ? { applicable: true } : { applicable: false, reason })}
              label={t("controlPage.applies")}
              description={c.applicable ? t("controlPage.appliesDetail") : t("controlPage.doesNotApply", { reason: c.reason })}
            />
            {editor && c.applicable && (
              <TextField label={t("controlPage.reason")} value={reason} onChange={(e) => setReason(e.target.value)} hint={t("controlPage.reasonHint")} />
            )}
            {error && <p className="m-0 text-xs text-danger">{error}</p>}
          </div>
        </Panel>
      </OverviewGrid>
    </>
  );
}

// ---------------------------------------------------------------- Checks

function ChecksPage({ call, reload }: { call: Call; reload: () => void }) {
  const t = useT();
  const { can } = useAuth();
  const [checks, setChecks] = useState<Check[]>();
  const [sources, setSources] = useState<Source[]>();
  const [reading, setReading] = useState(false);
  const load = useCallback(() => {
    void call<{ checks: Check[] }>("/api/v1/checks").then(
      (r) => setChecks(r.checks),
      () => setChecks([]),
    );
    void call<{ sources: Source[] }>("/api/v1/sources").then(
      (r) => setSources(r.sources),
      () => setSources([]),
    );
  }, [call]);
  useEffect(load, [load]);
  const readNow = async () => {
    setReading(true);
    try {
      await call("/api/v1/collect", { method: "POST" });
      load();
      reload();
    } finally {
      setReading(false);
    }
  };
  const sourceColumns: Column<Source>[] = [
    { id: "product", header: t("checksPage.product"), width: "160px", cell: (s) => <span className="font-medium">{productName(s.product)}</span> },
    { id: "url", header: t("checksPage.address"), cell: (s) => <span className="compliance-wrap font-mono text-xs">{s.url}</span> },
    {
      id: "state",
      header: t("checksPage.state"),
      width: "240px",
      cell: (s) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={s.state === "ok" ? "success" : s.state === "failing" ? "danger" : "neutral"}>{t(`sourceStates.${s.state}`)}</StatusBadge>
          {s.error && (
            <span className="compliance-clamp text-2xs text-danger" title={s.error}>
              {s.error}
            </span>
          )}
          {s.lastAt && <span className="text-2xs text-fg-muted">{when(s.lastAt)}</span>}
        </span>
      ),
    },
  ];
  const columns: Column<Check>[] = [
    { id: "product", header: t("checksPage.product"), width: "140px", sortValue: (x) => x.product, cell: (x) => <Badge>{productName(x.product)}</Badge> },
    {
      id: "check",
      header: t("checksPage.check"),
      sortValue: (x) => x.title,
      cell: (x) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{x.title}</span>
          <span className="compliance-clamp font-mono text-2xs text-fg-muted" title={x.expression}>
            {x.expression}
          </span>
        </span>
      ),
    },
    { id: "value", header: t("checksPage.value"), width: "100px", align: "right", mono: true, cell: (x) => (x.value === null ? "–" : x.value) },
    {
      id: "controls",
      header: t("checksPage.controls"),
      width: "90px",
      align: "right",
      mono: true,
      sortValue: (x) => x.controls.length,
      cell: (x) => x.controls.length,
    },
    { id: "state", header: t("checksPage.state"), width: "130px", sortValue: (x) => x.state, cell: (x) => <CheckBadge state={x.state} /> },
  ];
  return (
    <>
      <PageHeader
        title={t("checksPage.checks")}
        description={t("checksPage.description")}
        actions={
          can("editor") && (
            <Button icon={<RefreshCw />} disabled={reading} onClick={() => void readNow()}>
              {reading ? t("checksPage.reading") : t("checksPage.readNow")}
            </Button>
          )
        }
      />
      <Panel title={t("checksPage.sources")} description={t("checksPage.sourcesDetail")} flush>
        <DataTable
          label={t("checksPage.sources")}
          columns={sourceColumns}
          rows={sources ?? []}
          loading={!sources}
          getRowId={(s) => s.product}
          minWidth={680}
          empty={<EmptyState title={t("overviewPage.noSources")}>{t("overviewPage.noSourcesDetail")}</EmptyState>}
        />
      </Panel>
      <Panel title={t("checksPage.checks")} flush>
        <DataTable
          label={t("checksPage.checks")}
          columns={columns}
          rows={checks ?? []}
          loading={!checks}
          getRowId={(x) => x.id}
          onRowClick={(x) => navigate(`/checks/${x.id}`)}
          minWidth={820}
        />
      </Panel>
    </>
  );
}

function CheckPage({ call, id, frameworks }: { call: Call; id: string; frameworks: Framework[] }) {
  const t = useT();
  const [c, setC] = useState<CheckDetail | null>();
  // The strip ends today, at midnight UTC, as the days are kept.
  const [today] = useState(() => Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`));
  useEffect(() => {
    void call<CheckDetail>(`/api/v1/checks/${encodeURIComponent(id)}`).then(setC, () => setC(null));
  }, [call, id]);
  if (c === null)
    return (
      <EmptyState title={t("checkPage.notFound")} action={<Button onClick={() => navigate("/checks")}>{t("checkPage.back")}</Button>}>
        {t("checkPage.notFoundDetail")}
      </EmptyState>
    );
  if (!c) return <EmptyState title={t("product.loading")} icon={<ShieldCheck />} />;
  const byDay = new Map(c.days.map((d) => [d.day, d]));
  const cells = Array.from({ length: 90 }, (_, i) => new Date(today - (89 - i) * 86_400_000).toISOString().slice(0, 10)).map((d) => {
    const x = byDay.get(d);
    return {
      id: d,
      label: day(d),
      tone: (!x ? "neutral" : x.passes === x.runs ? "success" : x.passes ? "warning" : "danger") as Tone,
      detail: x ? t("checkPage.dayDetail", { passes: x.passes, runs: x.runs, value: x.value }) : t("checkPage.noRead"),
    };
  });
  return (
    <>
      <PageHeader
        title={c.title}
        breadcrumbs={[{ label: t("checksPage.checks"), href: "/checks" }, { label: productName(c.product) }]}
        description={c.at ? t("checkPage.readAt", { when: when(c.at), value: c.value ?? "–" }) : undefined}
        meta={<CheckBadge state={c.state} />}
      />
      <Panel title={t("checkPage.rule")}>
        <pre className="m-0 overflow-x-auto rounded-md bg-subtle px-2.5 py-2 font-mono text-xs text-fg">{c.expression}</pre>
        <p className="m-0 mt-2 text-xs text-fg-muted">{t(`checkHints.${c.state}`, { product: productName(c.product) })}</p>
      </Panel>
      <Panel title={t("checkPage.last90")} description={t("checkPage.last90Detail")}>
        <StatusStrip label={t("checkPage.last90")} height={36} start={t("checkPage.daysAgo", { n: 90 })} end={t("checkPage.today")} cells={cells} />
      </Panel>
      <Panel title={t("checkPage.proves")} flush>
        <ul className="compliance-list">
          {c.controls.map((x) => (
            <li key={`${x.framework} ${x.ref}`} className="border-b border-subtle px-3 py-2 text-sm last:border-0">
              <a href={controlPath(x.framework, x.ref)}>
                {frameworks.find((f) => f.id === x.framework)?.name ?? x.framework} {x.ref}
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Frameworks

function FrameworksPage({ call, frameworks, reload }: { call: Call; frameworks: Framework[]; reload: () => void }) {
  const t = useT();
  const { can } = useAuth();
  const [error, setError] = useState<string>();
  const set = async (id: string, enabled: boolean) => {
    try {
      await call(`/api/v1/frameworks/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) });
      setError(undefined);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <>
      <PageHeader title={t("frameworksPage.frameworks")} description={t("frameworksPage.description")} />
      {error && <Callout tone="danger" title={error} />}
      {frameworks.map((f) => (
        <Panel
          key={f.id}
          title={f.name}
          description={t("frameworksPage.counts", { controls: f.controls, passing: f.passing })}
          actions={<ReportButtons framework={f.id} />}
        >
          <Switch
            checked={f.enabled}
            disabled={!can("admin")}
            onCheckedChange={(v) => void set(f.id, v)}
            label={t("frameworksPage.inScope")}
            description={t("frameworksPage.inScopeDetail")}
          />
        </Panel>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- Shell

/** Account, Members, Sign-in and API tokens: the screens come from @openasy/auth. */
function SettingsPage({ page }: { page: "account" | "members" | "signin" | "tokens" }) {
  const t = useT();
  const { signOut, can } = useAuth();
  if (page !== "account" && !can("admin")) return <EmptyState title={t("settingsPage.adminsOnly")}>{t("settingsPage.askAnAdmin")}</EmptyState>;
  return (
    <>
      <PageHeader
        title={t(`settingsPage.${page}.title`)}
        description={t(`settingsPage.${page}.description`)}
        actions={
          page === "account" && (
            <Button icon={<LogOut />} onClick={() => void signOut()}>
              {t("settingsPage.signOut")}
            </Button>
          )
        }
      />
      {page === "account" ? <AccountSettings /> : page === "members" ? <MembersSettings /> : page === "signin" ? <SignInSettings /> : <TokensSettings />}
    </>
  );
}

function Product() {
  const msg = useT();
  const [theme, setTheme] = useThemePreference();
  const [, setLocale] = useLocalePreference();
  const { me, can } = useAuth();
  const account = useAccountMenu();
  const path = usePath();
  const route = parseRoute(path);
  const [summary, setSummary] = useState<Summary>();
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [products, setProducts] = useState<Array<ProductLink & { id: ProductId }>>([]);
  const call = useApi();
  const onSearch = useMemo(() => search(call, msg), [call, msg]);

  // The install's other products (OPENASY_PRODUCTS), for the switcher; ids this UI does not know are left out.
  useEffect(() => {
    void call<{ products: ProductLink[] }>("/api/v1/products").then(
      (r) =>
        setProducts(r.products.filter((p): p is ProductLink & { id: ProductId } => p.id !== "compliance" && (PRODUCT_IDS as readonly string[]).includes(p.id))),
      () => {},
    );
  }, [call]);

  const reload = useCallback(() => {
    void call<Summary>("/api/v1/summary").then(setSummary, () => {});
    void call<{ frameworks: Framework[] }>("/api/v1/frameworks").then(
      (r) => setFrameworks(r.frameworks),
      () => {},
    );
  }, [call]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  const nav = [
    { id: "overview", label: msg("product.overview"), icon: LayoutDashboard },
    { id: "controls", label: msg("product.controls"), icon: ShieldCheck, count: summary?.totals.failing || undefined },
    { id: "checks", label: msg("product.checks"), icon: FileCheck2, count: summary?.sources.failing || undefined },
    { id: "frameworks", label: msg("product.frameworks"), icon: Library },
  ];
  const footerNav = [
    ...(can("admin")
      ? [
          { id: "members", label: msg("product.members"), icon: Users },
          { id: "signin", label: msg("product.signIn"), icon: LogIn },
          { id: "tokens", label: msg("product.apiTokens"), icon: KeyRound },
        ]
      : []),
    { id: "account", label: msg("product.account"), icon: UserRound },
  ];
  const roleName = me.user.role.charAt(0).toUpperCase() + me.user.role.slice(1);
  const settings = route.page === "account" || route.page === "members" || route.page === "signin" || route.page === "tokens";

  return (
    <AppShell
      product="compliance"
      onSearch={onSearch}
      about={colophon}
      nav={nav}
      activeNav={route.page === "control" ? "controls" : route.page === "check" ? "checks" : route.page}
      onNavigate={(id) => navigate(`/${id}`)}
      connectedProducts={products.map((p) => p.id)}
      onSwitchProduct={(id) => {
        const to = products.find((p) => p.id === id);
        if (to) window.location.assign(to.url);
      }}
      footerNav={account.settings(footerNav)}
      user={{ name: me.user.name, role: roleName, ...account.user }}
      theme={theme}
      onThemeChange={setTheme}
      onLanguageChange={(code) => setLocale(toLocale(code))}
    >
      {settings ? (
        <SettingsPage page={route.page as "account" | "members" | "signin" | "tokens"} />
      ) : !summary ? (
        <EmptyState title={msg("product.loading")} icon={<ShieldCheck />}>
          {msg("product.reading")}
        </EmptyState>
      ) : route.page === "overview" ? (
        <OverviewPage summary={summary} />
      ) : route.page === "controls" ? (
        // The address carries the filters, so a link from the overview opens the list narrowed.
        <ControlsPage key={window.location.search} call={call} frameworks={frameworks} />
      ) : route.page === "control" ? (
        <ControlPage key={`${route.framework} ${route.ref}`} call={call} framework={route.framework} reference={route.ref} reload={reload} />
      ) : route.page === "checks" ? (
        <ChecksPage call={call} reload={reload} />
      ) : route.page === "check" ? (
        <CheckPage key={route.id} call={call} id={route.id} frameworks={frameworks} />
      ) : (
        <FrameworksPage call={call} frameworks={frameworks} reload={reload} />
      )}
    </AppShell>
  );
}

export function App() {
  const installBrand = useInstallBrand();
  const [theme] = useThemePreference();
  const [locale] = useLocalePreference();
  return (
    // The install's brand from config/brand.env (ADR 0053); OpenAsy's own look where it sets none.
    <BrandProvider theme={theme} locale={locale} brand={{ name: "OpenAsy", organization: undefined, ...installBrand }} className="min-h-screen">
      <AuthGate product="OpenAsy Compliance">
        <Product />
      </AuthGate>
    </BrandProvider>
  );
}
