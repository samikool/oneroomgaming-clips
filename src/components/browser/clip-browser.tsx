"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Scope } from "@/db/browse";
import type { BrowseOptions } from "@/db/browse-options";
import { isFiltered, SORTS, type BrowseQuery, type Sort } from "@/lib/browse/query";
import type { Page } from "@/lib/browse/tab-state";
import { useBrowse } from "@/lib/browse/use-browse";
import { MAX_IDS } from "@/lib/clips/bulk-changes";
import { leavesSelectMode, toggleSelection } from "@/lib/clips/selection";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { LikeButton } from "../like-button";
import { BrowseBar } from "./browse-bar";
import { BrowseContext } from "./browse-context";
import { BrowserCard } from "./browser-card";
import { BulkEditDrawer } from "./bulk-edit";
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
  barExtras,
  selectable = false,
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
  barExtras?: ReactNode;
  /** Home only: a Select mode for bulk editing. */
  selectable?: boolean;
}) {
  const pages = useMemo(
    () => Object.fromEntries(SORTS.map((sort) => [sort, initialPages[sort] ?? { clips: [], next: null }])) as Record<Sort, Page>,
    [initialPages],
  );
  const browse = useBrowse({ initialQuery, initialPages: pages, scope });
  const { state, active, query } = browse;
  const filtered = isFiltered(query);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const shownIds = state.tabs[active].clips.map((c) => c.id);

  function stop() {
    setSelecting(false);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((cur) => (cur.has(id) || cur.size < MAX_IDS ? toggleSelection(cur, id) : cur));
  }

  useEffect(() => {
    if (!selecting || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (leavesSelectMode(e)) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, editing]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(""), 5000);
    return () => clearTimeout(timer);
  }, [note]);

  const renderCard = (clip: ClipSummary) => (
    <BrowserCard
      clip={clip}
      scope={scope}
      actions={cardActions?.(clip)}
      selecting={selectable && selecting}
      selected={selected.has(clip.id)}
      onToggle={() => toggle(clip.id)}
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
        <BrowseBar
          browse={browse}
          options={options}
          trailing={
            <>
              {barExtras}
              {selectable &&
                (selecting ? (
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="chip-button"
                      onClick={() => setSelected((cur) => new Set([...cur, ...shownIds].slice(0, MAX_IDS)))}
                    >
                      Select all shown
                    </button>
                    <button type="button" className="chip-button" onClick={stop}>
                      Done
                    </button>
                  </span>
                ) : (
                  <button type="button" className="chip-button" onClick={() => setSelecting(true)}>
                    Select
                  </button>
                ))}
            </>
          }
        />

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
          <div className="selection-bar" role="region" aria-label="Selected clips">
            <span>
              {selected.size} selected{selected.size >= MAX_IDS ? ` (max ${MAX_IDS})` : ""}
            </span>
            <span className="flex gap-2">
              <button type="button" className="button-primary" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" className="button-secondary" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </span>
          </div>
        )}
        {note && (
          <p role="status" className="selection-note">
            {note}
          </p>
        )}
        {editing && (
          <BulkEditDrawer
            ids={[...selected]}
            onClose={() => setEditing(false)}
            onSaved={(message) => {
              setEditing(false);
              stop();
              setNote(message);
            }}
          />
        )}

      </section>
    </BrowseContext.Provider>
  );
}
