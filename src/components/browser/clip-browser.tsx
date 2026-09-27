"use client";

import { useMemo, type ReactNode } from "react";
import type { Scope } from "@/db/browse";
import type { BrowseOptions } from "@/db/browse-options";
import { isFiltered, SORTS, type BrowseQuery, type Sort } from "@/lib/browse/query";
import type { Page } from "@/lib/browse/tab-state";
import { useBrowse } from "@/lib/browse/use-browse";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { LikeButton } from "../like-button";
import { BrowseBar } from "./browse-bar";
import { BrowseContext } from "./browse-context";
import { BrowserCard } from "./browser-card";
import { BrowserPanel, type Density } from "./browser-panel";
import { TabStrip } from "./tab-strip";

/**
 * Home's and the theater's clip browser: New, Trending, Top and Random, every
 * tab preloaded, one shared search and filter, infinite scroll, live updates.
 * Only the card actions differ between the two pages. Browsing is this
 * viewer's own and never goes through the room.
 */
export function ClipBrowser({
  initialQuery,
  initialPages,
  scope,
  density,
  options,
  cardActions,
  renderLike,
  me,
}: {
  initialQuery: BrowseQuery;
  initialPages: Partial<Record<Sort, Page>>;
  scope: Scope;
  density: Density;
  options: BrowseOptions;
  cardActions?: (clip: ClipSummary) => ReactNode;
  renderLike?: (clip: ClipSummary) => ReactNode;
  /** The viewer. With it, every card gets a live like button; without, a read-only count. */
  me?: string;
}) {
  const pages = useMemo(
    () => Object.fromEntries(SORTS.map((sort) => [sort, initialPages[sort] ?? { clips: [], next: null }])) as Record<Sort, Page>,
    [initialPages],
  );
  const browse = useBrowse({ initialQuery, initialPages: pages, scope });
  const { state, active, query } = browse;
  const filtered = isFiltered(query);

  const renderCard = (clip: ClipSummary) => (
    <BrowserCard
      clip={clip}
      scope={scope}
      actions={cardActions?.(clip)}
      like={
        renderLike?.(clip) ??
        (me ? (
          <LikeButton
            compact
            clipId={clip.id}
            me={me}
            initialCount={clip.likeCount}
            initialLiked={clip.likedByMe}
            isOwn={clip.uploader === me}
          />
        ) : undefined)
      }
    />
  );

  const actions = useMemo(() => ({ toggleFilter: browse.toggleFilter }), [browse.toggleFilter]);

  return (
    <BrowseContext.Provider value={actions}>
      <section className="clip-browser">
        <BrowseBar browse={browse} options={options} />

        <TabStrip active={active} onChange={browse.setActive}>
          {SORTS.map((sort) => (
            <BrowserPanel
              key={sort}
              tab={state.tabs[sort]}
              sort={sort}
              active={sort === active}
              scope={scope}
              density={density}
              filtered={filtered}
              onLoadMore={() => browse.loadMore(sort)}
              onRetry={browse.retry}
              onClearFilters={browse.clearFilters}
              renderCard={renderCard}
            />
          ))}
        </TabStrip>

      </section>
    </BrowseContext.Provider>
  );
}
