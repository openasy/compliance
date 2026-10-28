// What the search window (Cmd+K) finds in Compliance: controls by reference, title or owner. The API filters them.
import type { SearchFn, SearchResult } from "@openasy/ui";
import { ShieldCheck } from "lucide-react";
import type { ControlSummary } from "./api.ts";
import type { T } from "./i18n.ts";

type Call = <R>(path: string, init?: RequestInit) => Promise<R>;

export function search(call: Call, t: T): SearchFn {
  return async (q, signal) => {
    const found = await call<{ controls: ControlSummary[] }>(`/api/v1/controls?q=${encodeURIComponent(q)}`, { signal });
    return found.controls.slice(0, 8).map((c): SearchResult => ({
      id: `control:${c.framework}:${c.ref}`,
      label: `${c.ref} ${c.title}`,
      detail: t(`controlStates.${c.state}`),
      kind: t("search.control"),
      icon: ShieldCheck,
      severity: c.state === "failing" ? "high" : undefined,
      href: `/controls/${c.framework}/${encodeURIComponent(c.ref)}`,
    }));
  };
}
