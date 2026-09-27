"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipGrid } from "./clip-grid";
import { CollectionGrid } from "./collection-card";
import type { CollectionSummary } from "@/db/collections";
import type { ClipSummary } from "@/lib/realtime/envelope";
import type { ProfileComment } from "@/db/profile-activity";
import { formatAgo } from "@/lib/format";

type Tab = "uploads" | "appearances" | "comments" | "collections";

const TABS: [Tab, string][] = [
  ["uploads", "Uploads"],
  ["appearances", "Appears in"],
  ["comments", "Comments"],
  ["collections", "Collections"],
];

/**
 * What someone has posted, appears in, and said. Plain grids for now; the
 * clip browser's grid replaces them when it lands.
 */
export function ProfileTabs({
  uploads,
  appearances,
  comments,
  collections,
  now,
}: {
  uploads: ClipSummary[];
  appearances: ClipSummary[];
  comments: ProfileComment[];
  /** The collections they own. */
  collections: CollectionSummary[];
  /** The server's clock at render, so "5m ago" reads the same on both sides of hydration. */
  now: number;
}) {
  const [tab, setTab] = useState<Tab>("uploads");
  const counts: Record<Tab, number> = {
    uploads: uploads.length,
    appearances: appearances.length,
    comments: comments.length,
    collections: collections.length,
  };

  return (
    <section className="mt-8">
      <div className="profile-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`nav-link${tab === key ? " nav-link-active profile-tab-active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label} <span className="ml-1.5 text-xs text-ink-muted">{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="mt-6" role="tabpanel">
        {tab === "collections" ? (
          <CollectionGrid collections={collections} empty="Nothing here yet." />
        ) : tab === "comments" ? (
          comments.length === 0 ? (
            <Empty />
          ) : (
            <ol className="flex flex-col gap-4">
              {comments.map((comment) => (
                <li key={comment.id} className="text-sm">
                  <p className="text-xs text-ink-muted">
                    on{" "}
                    <Link href={`/clips/${comment.clipId}`} className="text-ink underline hover:text-brand">
                      {comment.clipTitle}
                    </Link>{" "}
                    · {formatAgo(comment.at, now)}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-ink">{comment.body}</p>
                </li>
              ))}
            </ol>
          )
        ) : (tab === "uploads" ? uploads : appearances).length === 0 ? (
          <Empty />
        ) : (
          <ClipGrid clips={tab === "uploads" ? uploads : appearances} />
        )}
      </div>
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-ink-muted">Nothing here yet.</p>;
}
