"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { deleteClips } from "@/app/actions";
import {
  isAllSelected,
  pruneSelection,
  selectAll,
  toggleSelection,
} from "@/lib/clips/selection";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { mergeClip, type ClipMap } from "@/lib/realtime/merge";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ClipGrid } from "./clip-grid";

/**
 * The server-rendered clips are the snapshot; live events merge on top. There
 * is no fetch on connect — the page load already did that work.
 */
export function LiveGrid({
  initial,
  live = true,
  canSelect = false,
}: {
  initial: ClipSummary[];
  live?: boolean;
  canSelect?: boolean;
}) {
  const [clips, setClips] = useState<ClipMap>(() =>
    Object.fromEntries(initial.map((clip) => [clip.id, clip])),
  );
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  useRealtime(["grid"], (message) => {
    // On a filtered grid, merging a new clip would show one that does not
    // match the filter. Status updates for clips already shown stay live.
    if (!live && message.t === "clip.added") {
      return;
    }

    setClips((state) => mergeClip(state, message));
  });

  const ordered = useMemo(
    () => Object.values(clips).sort((a, b) => b.createdAt - a.createdAt),
    [clips],
  );

  const presentIds = useMemo(() => ordered.map((clip) => clip.id), [ordered]);

  // Another admin deleting a clip this browser has selected must not leave the
  // action bar counting a card that is no longer on screen. `pruneSelection`
  // returns the same Set when nothing changed, so React bails out of the
  // update and this cannot loop.
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
      // The grid drops the cards from the clip.removed events; this only
      // resets the toolbar.
      leaveSelectMode();
    });
  }

  return (
    <>
      {canSelect && (
        <div className="mb-4 flex justify-end gap-2">
          {selecting && presentIds.length > 0 && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setSelected(allSelected ? new Set() : selectAll(presentIds));
                // Same reason as onToggle: a confirmation on screen would show
                // a stale count.
                setConfirming(false);
              }}
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          )}
          <button
            type="button"
            className="button-secondary"
            onClick={() => (selecting ? leaveSelectMode() : setSelecting(true))}
          >
            {selecting ? "Done" : "Select"}
          </button>
        </div>
      )}

      <ClipGrid
        clips={ordered}
        selectable={selecting}
        selected={selected}
        onToggle={(id) => {
          setSelected((current) => toggleSelection(current, id));
          // Changing the selection invalidates a confirmation already on
          // screen — otherwise the button says "Delete 2" and deletes 3.
          setConfirming(false);
        }}
      />

      {selecting && selected.size > 0 && (
        <div className="select-bar" role="status">
          {confirming ? (
            <>
              <span className="text-sm">
                Delete {selected.size} clip{selected.size === 1 ? "" : "s"} permanently? This
                cannot be undone.
              </span>
              <button
                type="button"
                className="button-secondary ml-auto"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Keep them
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={confirmDelete}
                disabled={pending}
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="select-bar-clear"
                aria-label="Clear selection"
                onClick={() => setSelected(new Set())}
              >
                ✕
              </button>
              <span className="text-sm">
                <span className="font-pixel text-accent">{selected.size}</span> selected
              </span>
              <button
                type="button"
                className="button-secondary ml-auto"
                onClick={leaveSelectMode}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={() => setConfirming(true)}
              >
                Delete {selected.size}…
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
