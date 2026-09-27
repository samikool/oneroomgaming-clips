"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Scope } from "@/db/browse";
import type { Sort } from "@/lib/browse/query";
import { shouldLoadMore, type TabData } from "@/lib/browse/tab-state";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { Spinner } from "../spinner";

export type Density = "comfortable" | "compact";

const GRID: Record<Density, string> = {
  comfortable: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  compact: "grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4",
};

/** The next page starts loading this far before the end. */
const SENTINEL_MARGIN = "600px";

function emptyMessage(sort: Sort, scope: Scope): string {
  switch (sort) {
    case "trending":
      return "Nothing's trending this week. Go watch something.";
    case "top":
      return "No likes yet.";
    default:
      return scope === "home"
        ? "No clips yet. Upload a video to give the room something to watch."
        : "Nothing is ready to play yet.";
  }
}

/** One tab's grid, its infinite-scroll sentinel, and its footer or empty state. */
export function BrowserPanel({
  tab,
  sort,
  active,
  scope,
  density,
  filtered,
  onLoadMore,
  onRetry,
  onClearFilters,
  renderCard,
}: {
  tab: TabData;
  sort: Sort;
  active: boolean;
  scope: Scope;
  density: Density;
  filtered: boolean;
  onLoadMore(): void;
  onRetry(): void;
  onClearFilters(): void;
  renderCard(clip: ClipSummary): ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const wanted = active && shouldLoadMore(tab);
  const loadMore = useRef(onLoadMore);
  loadMore.current = onLoadMore;

  // Re-created after every page, so a short page that leaves the sentinel in
  // view asks again; stops for good once `next` is null.
  useEffect(() => {
    const el = sentinel.current;
    if (!wanted || !el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore.current();
      },
      { rootMargin: SENTINEL_MARGIN },
    );
    observer.observe(el);

    return () => observer.disconnect();
  }, [wanted, tab.clips.length]);

  const retry = (
    <p className="browse-footer">
      Couldn&apos;t load —{" "}
      <button type="button" className="underline hover:text-ink" onClick={onRetry}>
        retry
      </button>
    </p>
  );

  if (tab.clips.length === 0) {
    if (tab.error) return retry;
    if (tab.loading) {
      return (
        <p className="browse-footer">
          <Spinner label="Loading clips" />
        </p>
      );
    }

    return filtered ? (
      <p className="browse-empty">
        Nothing matches.{" "}
        <button type="button" className="underline hover:text-ink" onClick={onClearFilters}>
          Clear all
        </button>
      </p>
    ) : (
      <p className="browse-empty">{emptyMessage(sort, scope)}</p>
    );
  }

  return (
    <div className={tab.stale ? "browse-stale" : undefined} aria-busy={tab.loading}>
      <div className={GRID[density]}>
        {tab.clips.map((clip) => (
          <div key={clip.id}>{renderCard(clip)}</div>
        ))}
      </div>
      <div ref={sentinel} aria-hidden="true" />
      {tab.error ? (
        retry
      ) : tab.loading ? (
        <p className="browse-footer">
          <Spinner label="Loading more clips" />
        </p>
      ) : tab.next === null ? (
        <p className="browse-footer">That&apos;s everything</p>
      ) : null}
    </div>
  );
}
