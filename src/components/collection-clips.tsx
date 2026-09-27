"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { moveInCollection, removeFromCollection } from "@/app/collections/actions";
import type { CollectionClip } from "@/db/collections";
import { canCollection } from "@/lib/collections/permissions";
import { gapInGrid } from "@/lib/drag/grid";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { dropTarget } from "@/lib/theater/queue-drag";
import { ClipTile } from "./clip-card";
import { UserName } from "./user-name";

/**
 * A collection's clips, in order. The owner drags the grip to reorder (the
 * same pointer-capture drag as the theater queue, over a wrapping grid) with
 * arrow buttons for keyboards; anyone allowed sees an ×. Every change is
 * optimistic and rolls back with a message when the server refuses.
 *
 * Live: `collection.updated` for this collection (or a member clip deleted)
 * refetches. A collection deleted meanwhile shows a note instead of a 404.
 */
export function CollectionClips({
  collectionId,
  clips: initial,
  me,
  isOwner,
  open,
}: {
  collectionId: string;
  clips: CollectionClip[];
  me: string;
  isOwner: boolean;
  open: boolean;
}) {
  const router = useRouter();
  const [clips, setClips] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  const gridRef = useRef<HTMLOListElement>(null);

  // A refresh brings new props; they replace the optimistic copy.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setClips(initial);
  }

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4_000);
    return () => clearTimeout(timer);
  }, [error]);

  async function refetch() {
    const response = await fetch(`/api/collections/${collectionId}`).catch(() => null);
    if (response?.status === 404) {
      setDeleted(true);
    } else {
      router.refresh();
    }
  }

  useRealtime(["grid"], (message) => {
    if (message.t === "collection.updated" && message.collectionId === collectionId) void refetch();
    if (message.t === "clip.removed" && clips.some((c) => c.id === message.clipId)) router.refresh();
  });

  useEffect(() => {
    if (dragFrom === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDragFrom(null);
        setDropBefore(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragFrom]);

  if (deleted) {
    return (
      <p className="text-sm text-ink-muted">
        This collection was deleted.{" "}
        <Link href="/collections" className="text-ink underline hover:text-brand">
          See all collections
        </Link>
      </p>
    );
  }

  function move(from: number, to: number) {
    const before = clips;
    const next = clips.filter((_, i) => i !== from);
    next.splice(to, 0, clips[from]);
    setClips(next);
    void moveInCollection(collectionId, clips[from].id, to).then((result) => {
      if (!result.ok) {
        setClips(before);
        setError(result.error);
      }
    });
  }

  function remove(clipId: string) {
    const before = clips;
    setClips(clips.filter((c) => c.id !== clipId));
    void removeFromCollection(collectionId, clipId).then((result) => {
      if (!result.ok) {
        setClips(before);
        setError(result.error);
      }
    });
  }

  function gapAt(x: number, y: number): number {
    const tiles = gridRef.current ? Array.from(gridRef.current.children) : [];
    return gapInGrid(x, y, tiles.map((tile) => tile.getBoundingClientRect()));
  }

  const target = dragFrom !== null && dropBefore !== null ? dropTarget(dragFrom, dropBefore) : null;

  if (clips.length === 0) {
    return (
      <>
        <p className="text-sm text-ink-muted">
          No clips here yet. Add one from a clip page, or from the ⋯ on any card.
        </p>
        {error && <p role="alert" className="collection-field-error mt-2">{error}</p>}
      </>
    );
  }

  return (
    <>
      {error && <p role="alert" className="collection-field-error mb-3">{error}</p>}
      <ol ref={gridRef} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {clips.map((clip, index) => {
          const removable = canCollection("remove", { isOwner, open, addedByMe: clip.addedBy === me });
          const tile = <ClipTile clip={clip} />;

          return (
            <li
              key={clip.id}
              className={[
                "collection-item",
                dragFrom === index && "collection-item-dragging",
                target !== null && dropBefore === index && "collection-drop-before",
                target !== null && dropBefore === clips.length && index === clips.length - 1 && "collection-drop-after",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {clip.status === "ready" ? (
                <Link href={`/clips/${clip.id}`} draggable={false}>
                  {tile}
                </Link>
              ) : (
                <div className="opacity-60">{tile}</div>
              )}
              <div className="collection-item-foot">
                <span className="min-w-0 truncate">
                  added by <UserName username={clip.addedBy} variant="compact" />
                </span>
                {isOwner && (
                  <span className="collection-item-actions">
                    <button
                      type="button"
                      className="queue-action"
                      aria-label={`Move ${clip.title} earlier`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="queue-action"
                      aria-label={`Move ${clip.title} later`}
                      disabled={index === clips.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      →
                    </button>
                  </span>
                )}
              </div>
              {isOwner && (
                <span
                  className="collection-grip"
                  aria-hidden="true"
                  title="Drag to reorder"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragFrom(index);
                    setDropBefore(gapAt(event.clientX, event.clientY));
                  }}
                  onPointerMove={(event) => {
                    if (dragFrom !== null) setDropBefore(gapAt(event.clientX, event.clientY));
                  }}
                  onPointerUp={(event) => {
                    const to = dragFrom === null ? null : dropTarget(dragFrom, gapAt(event.clientX, event.clientY));
                    if (dragFrom !== null && to !== null) move(dragFrom, to);
                    setDragFrom(null);
                    setDropBefore(null);
                  }}
                  onPointerCancel={() => {
                    setDragFrom(null);
                    setDropBefore(null);
                  }}
                />
              )}
              {removable && (
                <button
                  type="button"
                  className="collection-remove"
                  aria-label={`Remove ${clip.title} from this collection`}
                  onClick={() => remove(clip.id)}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Refreshes a server-rendered list of collections when any of them changes. */
export function CollectionsLive() {
  const router = useRouter();
  useRealtime(["grid"], (message) => {
    if (message.t === "collection.updated" || message.t === "clip.removed") router.refresh();
  });
  return null;
}
