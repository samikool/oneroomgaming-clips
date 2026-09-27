"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { deleteClips } from "@/app/actions";
import type { Scope } from "@/db/browse";
import type { BrowseOptions } from "@/db/browse-options";
import { isFiltered, SORTS, type BrowseQuery, type Sort } from "@/lib/browse/query";
import type { Page } from "@/lib/browse/tab-state";
import { useBrowse } from "@/lib/browse/use-browse";
import { isAllSelected, pruneSelection, selectAll, toggleSelection } from "@/lib/clips/selection";
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
  selection,
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
  /** Home admin only: select-and-delete, until the admin page takes it over. */
  selection?: { enabled: boolean };
}) {
  const pages = useMemo(
    () => Object.fromEntries(SORTS.map((sort) => [sort, initialPages[sort] ?? { clips: [], next: null }])) as Record<Sort, Page>,
    [initialPages],
  );
  const browse = useBrowse({ initialQuery, initialPages: pages, scope });
  const { state, active, query } = browse;
  const filtered = isFiltered(query);
  const canSelect = selection?.enabled ?? false;

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  // Selection spans the active tab's loaded clips. A clip deleted elsewhere,
  // or a switch to another tab, must not leave the toolbar counting cards
  // that are not on screen. `pruneSelection` returns the same Set when nothing
  // changed, so this cannot loop.
  const presentIds = useMemo(() => state.tabs[active].clips.map((clip) => clip.id), [state.tabs, active]);
  useEffect(() => {
    setSelected((current) => pruneSelection(current, presentIds));
  }, [presentIds]);
  const allSelected = isAllSelected(selected, presentIds);

  function leaveSelectMode() {
    setSelecting(false);
    setSelected(new Set());
    setConfirming(false);
  }

  function confirmDelete() {
    const ids = [...selected];

    startTransition(async () => {
      await deleteClips(ids);
      // The tabs drop the cards from the clip.removed events; this only resets the toolbar.
      leaveSelectMode();
    });
  }

  const selectControls = canSelect && (
    <>
      {selecting && presentIds.length > 0 && (
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setSelected(allSelected ? new Set() : selectAll(presentIds));
            setConfirming(false);
          }}
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      )}
      <button type="button" className="button-secondary" onClick={() => (selecting ? leaveSelectMode() : setSelecting(true))}>
        {selecting ? "Done" : "Select"}
      </button>
    </>
  );

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
      selection={
        selecting
          ? {
              selecting,
              selected: selected.has(clip.id),
              onToggle: (id) => {
                setSelected((current) => toggleSelection(current, id));
                // A confirmation on screen would otherwise say "Delete 2" and delete 3.
                setConfirming(false);
              },
            }
          : undefined
      }
    />
  );

  const actions = useMemo(() => ({ toggleFilter: browse.toggleFilter }), [browse.toggleFilter]);

  return (
    <BrowseContext.Provider value={actions}>
      <section className="clip-browser">
        <BrowseBar browse={browse} options={options} trailing={selectControls || undefined} />

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

        {selecting && selected.size > 0 && (
          <div className="select-bar" role="status">
            {confirming ? (
              <>
                <span className="text-sm">
                  Delete {selected.size} clip{selected.size === 1 ? "" : "s"} permanently? This cannot be undone.
                </span>
                <button type="button" className="button-secondary ml-auto" onClick={() => setConfirming(false)} disabled={pending}>
                  Keep them
                </button>
                <button type="button" className="button-danger" onClick={confirmDelete} disabled={pending}>
                  {pending ? "Deleting…" : "Delete"}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="select-bar-clear" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                  ✕
                </button>
                <span className="text-sm">
                  <span className="font-pixel text-accent">{selected.size}</span> selected
                </span>
                <button type="button" className="button-secondary ml-auto" onClick={leaveSelectMode}>
                  Cancel
                </button>
                <button type="button" className="button-danger" onClick={() => setConfirming(true)}>
                  Delete {selected.size}…
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </BrowseContext.Provider>
  );
}
