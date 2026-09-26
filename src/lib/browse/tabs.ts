import type { Db } from "@/db/client";
import { browseClips, zeroScores, type Scope, type Scores } from "@/db/browse";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { SORTS, type BrowseQuery, type Sort } from "./query";

export function parseTabs(raw: string | null, fallback: Sort): Sort[] {
  const tabs = [...new Set((raw ?? "").split(","))].filter((tab): tab is Sort => (SORTS as readonly string[]).includes(tab));
  return tabs.length > 0 ? tabs : [fallback];
}

export function parseScope(raw: string | null): Scope {
  return raw === "theater" ? "theater" : "home";
}

export function browseTabs(
  db: Db,
  query: BrowseQuery,
  { tabs, cursor, scope, userId, scores = zeroScores }: { tabs: Sort[]; cursor?: string | null; scope: Scope; userId: string; scores?: Scores },
): { tabs: Partial<Record<Sort, { clips: ClipSummary[]; next: string | null }>> } {
  const out: Partial<Record<Sort, { clips: ClipSummary[]; next: string | null }>> = {};

  for (const sort of tabs) {
    out[sort] = browseClips(db, { ...query, sort }, {
      // One cursor can only mean one tab's position.
      cursor: tabs.length === 1 ? cursor : null,
      scope,
      userId,
      scores,
    });
  }

  return { tabs: out };
}
