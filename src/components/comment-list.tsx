"use client";

import { useState } from "react";
import { removeComment } from "@/app/clips/[id]/actions";
import type { CommentRow } from "@/db/comments";
import { TOMBSTONE } from "@/db/comments";
import { useRealtime } from "@/lib/realtime/use-realtime";

/**
 * Server-rendered comments with live ones merged on top.
 *
 * `comment.added` rides the `grid` topic because topics are a fixed enum, so
 * this filters by clipId. For a handful of friends that is cheaper than
 * parameterised subscriptions.
 */
export function CommentList({
  clipId,
  initial,
  me,
}: {
  clipId: string;
  initial: CommentRow[];
  me: string;
}) {
  const [comments, setComments] = useState<CommentRow[]>(initial);

  useRealtime(["grid"], (message) => {
    if (message.t !== "comment.added" || message.comment.clipId !== clipId) {
      return;
    }

    setComments((current) =>
      current.some((existing) => existing.id === message.comment.id)
        ? current
        : [...current, message.comment],
    );
  });

  if (comments.length === 0) {
    return <p className="text-sm text-ink-muted">No comments yet.</p>;
  }

  return (
    <ol className="comment-list">
      {comments.map((comment) => (
        <li key={comment.id} className="comment">
          <p className="text-xs text-ink-muted">{comment.user}</p>
          <p className={comment.deleted ? "text-sm italic text-ink-muted" : "text-sm text-ink"}>
            {comment.body}
          </p>
          {!comment.deleted && comment.user === me && (
            <button
              type="button"
              className="comment-delete"
              onClick={() => {
                setComments((current) =>
                  current.map((existing) =>
                    existing.id === comment.id
                      ? { ...existing, body: TOMBSTONE, deleted: true }
                      : existing,
                  ),
                );
                void removeComment(clipId, comment.id);
              }}
            >
              delete
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
