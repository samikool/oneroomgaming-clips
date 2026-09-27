import type { Scope } from "@/db/browse";
import { serializeBrowseQuery, type BrowseQuery, type Sort } from "./query";
import type { Page } from "./tab-state";

export type BrowseResponse = { tabs: Partial<Record<Sort, Page>> };

/** The API always gets the seed, so Random pages continue one shuffle; the address bar never does. */
export function browseUrl(
  query: BrowseQuery,
  { scope, tabs, cursor }: { scope: Scope; tabs: readonly Sort[]; cursor?: string | null },
): string {
  const extra = new URLSearchParams({ scope, tabs: tabs.join(",") });
  if (cursor) extra.set("cursor", cursor);

  const qs = serializeBrowseQuery(query, { includeSeed: true });
  return `/api/clips/browse?${qs ? `${qs}&` : ""}${extra.toString()}`;
}

export async function fetchTabs(
  query: BrowseQuery,
  opts: { scope: Scope; tabs: readonly Sort[]; cursor?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<BrowseResponse> {
  const response = await fetchImpl(browseUrl(query, opts));

  if (!response.ok) {
    throw new Error(`Browse request failed: ${response.status}`);
  }

  return (await response.json()) as BrowseResponse;
}
