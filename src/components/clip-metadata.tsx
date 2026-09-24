"use client";

import Link from "next/link";
import { useState } from "react";
import { saveGame, saveParticipants, saveTags } from "@/app/clips/[id]/actions";
import type { ClipMetadata } from "@/db/metadata";
import { withFilter } from "@/lib/filters";

/**
 * Metadata that is both a filter affordance and an edit surface.
 *
 * Filtering is by clicking metadata, not by a filter bar: it costs almost no
 * UI, is discoverable without explanation, and extends to any field added
 * later for free.
 */
export function ClipMetadataPanel({
  clipId,
  metadata,
  knownUsers,
}: {
  clipId: string;
  metadata: ClipMetadata;
  knownUsers: string[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="metadata-panel">
        <form className="metadata-form" action={saveTags.bind(null, clipId)}>
          <label className="metadata-label" htmlFor="tags">
            Tags, comma separated
          </label>
          <div className="metadata-row">
            <input
              id="tags"
              name="tags"
              className="title-input"
              defaultValue={metadata.tags.join(", ")}
              placeholder="ace, clutch"
            />
            <button type="submit" className="button-secondary">
              Save
            </button>
          </div>
        </form>

        <form className="metadata-form" action={saveGame.bind(null, clipId)}>
          <label className="metadata-label" htmlFor="game">
            Game
          </label>
          <div className="metadata-row">
            <input
              id="game"
              name="game"
              className="title-input"
              defaultValue={metadata.game?.name ?? ""}
              placeholder="Valorant"
            />
            <button type="submit" className="button-secondary">
              Save
            </button>
          </div>
        </form>

        <form className="metadata-form" action={saveParticipants.bind(null, clipId)}>
          <label className="metadata-label" htmlFor="participants">
            Who is in it — {knownUsers.join(", ")}
          </label>
          <div className="metadata-row">
            <input
              id="participants"
              name="participants"
              className="title-input"
              defaultValue={metadata.participants.join(", ")}
              placeholder="sam, dave"
            />
            <button type="submit" className="button-secondary">
              Save
            </button>
          </div>
        </form>

        <button type="button" className="chip-button self-start" onClick={() => setEditing(false)}>
          Done
        </button>
      </div>
    );
  }

  const nothingSet =
    metadata.tags.length === 0 && metadata.game === null && metadata.participants.length === 0;

  return (
    <div className="metadata-chips">
      {metadata.game && (
        <Link className="chip-button" href={withFilter({}, "game", metadata.game.slug)}>
          {metadata.game.name}
        </Link>
      )}
      {metadata.tags.map((tag) => (
        <Link key={tag} className="chip-button" href={withFilter({}, "tag", tag)}>
          #{tag}
        </Link>
      ))}
      {metadata.participants.map((user) => (
        <Link key={user} className="chip-button" href={withFilter({}, "participant", user)}>
          {user}
        </Link>
      ))}
      {nothingSet && <span className="text-sm text-ink-muted">No tags yet.</span>}
      <button type="button" className="chip-button" onClick={() => setEditing(true)}>
        Edit
      </button>
    </div>
  );
}
