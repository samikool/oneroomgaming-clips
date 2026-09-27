"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SinceLastVisit as Data } from "@/db/since";
import { formatAgo } from "@/lib/format";

const KEY = "dismissed-visit";

/**
 * "Since you were last here": new clips and what your clips got. Dismissing
 * hides it for this visit only — the flag is the visit's start time, so the
 * next visit shows a fresh strip.
 */
export function SinceLastVisit({ data, visitKey }: { data: Data; visitKey: number | undefined }) {
  // Hidden until storage has been checked, so a dismissed strip never flashes.
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = visitKey !== undefined && localStorage.getItem(KEY) === String(visitKey);
    } catch {
      // Storage blocked: the strip shows, and dismissing lasts until reload.
    }
    setHidden(dismissed);
  }, [visitKey]);

  if (hidden) return null;

  function dismiss(): void {
    setHidden(true);
    try {
      if (visitKey !== undefined) localStorage.setItem(KEY, String(visitKey));
    } catch {
      // Not remembered; hidden for now anyway.
    }
  }

  const { newClipCount, newClips, likes, comments, since } = data;

  return (
    <section className="since-strip" aria-label="Since you were last here">
      <div className="since-head">
        <div className="min-w-0">
          {newClipCount > 0 && (
            <p className="text-sm text-ink">
              {newClipCount} new {newClipCount === 1 ? "clip" : "clips"} since {formatAgo(since)}
              {" · "}
              <Link href="/?sort=new" className="underline hover:text-brand">
                See them
              </Link>
            </p>
          )}
          {(likes > 0 || comments > 0) && (
            <p className="text-sm text-ink-muted">
              Your clips got {likes} {likes === 1 ? "like" : "likes"} and {comments}{" "}
              {comments === 1 ? "comment" : "comments"}
            </p>
          )}
        </div>
        <button type="button" className="dock-dismiss" aria-label="Dismiss" onClick={dismiss}>
          ×
        </button>
      </div>
      {newClips.length > 0 && (
        <ul className="since-thumbs">
          {newClips.map((clip) => (
            <li key={clip.id}>
              <Link href={`/clips/${clip.id}`} title={clip.title} className="since-thumb">
                {clip.thumbPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={clip.thumbPath} alt={clip.title} loading="lazy" />
                ) : (
                  <span className="sr-only">{clip.title}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
