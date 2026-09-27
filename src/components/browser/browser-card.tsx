"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Scope } from "@/db/browse";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { ClipTile } from "../clip-card";
import { PersonChip } from "../person-chip";
import { useBrowseActions } from "./browse-context";

export type CardSelection = { selecting: boolean; selected: boolean; onToggle(id: string): void };

/** The heart until the activity branch's LikeButton is wired into the slot: a read-only count. */
export function LikeCount({ clip }: { clip: ClipSummary }) {
  return (
    <span
      className={`like-count${clip.likedByMe ? " like-count-mine" : ""}`}
      aria-label={`${clip.likeCount} ${clip.likeCount === 1 ? "like" : "likes"}${clip.likedByMe ? ", including yours" : ""}`}
    >
      <span aria-hidden="true">{clip.likedByMe ? "♥" : "♡"}</span>
      <span className="font-pixel text-[10px]">{clip.likeCount}</span>
    </span>
  );
}

/**
 * One clip in the browser. Home opens the clip; the theater's tile is not a
 * link, and its overlay carries Queue and Play now. The footer's chips add a
 * filter in place rather than navigating.
 */
export function BrowserCard({
  clip,
  scope,
  actions,
  like,
  selection,
}: {
  clip: ClipSummary;
  scope: Scope;
  actions?: ReactNode;
  like?: ReactNode;
  selection?: CardSelection;
}) {
  const browse = useBrowseActions();

  // Selecting drops the chips: a filter change mid-selection would swap the
  // cards out from under it.
  if (selection?.selecting) {
    return (
      <div>
        <button
          type="button"
          aria-pressed={selection.selected}
          onClick={() => selection.onToggle(clip.id)}
          className={`relative block w-full cursor-pointer text-left${selection.selected ? " clip-selected" : ""}`}
        >
          <span aria-hidden="true" className={`clip-check${selection.selected ? " clip-check-on" : ""}`} />
          <span className={clip.status === "ready" ? undefined : "block opacity-60"}>
            <ClipTile clip={clip} />
          </span>
          <span className="sr-only">{selection.selected ? "Selected" : "Not selected"}</span>
        </button>
      </div>
    );
  }

  const footer = (
    <div className="browser-card-foot">
      {like ?? <LikeCount clip={clip} />}
      {clip.uploader && (
        <PersonChip
          username={clip.uploader}
          className="meta-chip"
          onFilter={() => browse?.toggleFilter("people", clip.uploader!)}
        />
      )}
      {clip.game && (
        <button type="button" className="meta-chip" onClick={() => browse?.toggleFilter("games", clip.game!.slug)}>
          {clip.game.name}
        </button>
      )}
    </div>
  );

  if (scope === "theater") {
    return (
      <div>
        <div className="theater-card">
          <ClipTile clip={clip} overlay={actions} />
        </div>
        {footer}
      </div>
    );
  }

  // The footer sits outside the tile's link: an anchor inside an anchor is invalid HTML.
  return (
    <div>
      {clip.status === "ready" ? (
        <Link href={`/clips/${clip.id}`}>
          <ClipTile clip={clip} overlay={actions} />
        </Link>
      ) : (
        <div className="opacity-60">
          <ClipTile clip={clip} overlay={actions} />
        </div>
      )}
      {footer}
    </div>
  );
}
