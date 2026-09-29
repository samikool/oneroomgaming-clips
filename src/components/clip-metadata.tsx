"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { pickIgdbGame, saveGame, saveParticipants, saveTags } from "@/app/clips/[id]/actions";
import type { ClipMetadata } from "@/db/metadata";
import { filterHref } from "@/lib/browse/query";
import { coverPublicPath } from "@/lib/media/paths";
import { GamePicker } from "./game-picker";
import { PersonChip } from "./person-chip";

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

        <div className="metadata-form">
          <span className="metadata-label">Game</span>
          <GameField clipId={clipId} initial={metadata.game?.name ?? ""} coverPath={metadata.game ? metadata.game.coverPath : undefined} />
        </div>

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
        <Link className="chip-button" href={filterHref("games", metadata.game.slug)}>
          {metadata.game.coverPath && (
            <img src={coverPublicPath(metadata.game.coverPath)} alt="" className="game-cover-chip" />
          )}
          {metadata.game.name}
        </Link>
      )}
      {metadata.tags.map((tag) => (
        <Link key={tag} className="chip-button" href={filterHref("tags", tag)}>
          #{tag}
        </Link>
      ))}
      {metadata.participants.map((user) => (
        <PersonChip
          key={user}
          username={user}
          className="chip-button"
          filterHref={filterHref("people", user)}
        />
      ))}
      {nothingSet && <span className="text-sm text-ink-muted">No tags yet.</span>}
      <button type="button" className="chip-button" onClick={() => setEditing(true)}>
        Edit
      </button>
    </div>
  );
}

/** `coverPath` is undefined when the clip has no game, null for a game without art. */
function GameField({ clipId, initial, coverPath }: { clipId: string; initial: string; coverPath: string | null | undefined }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function saveText(name: string) {
    const form = new FormData();
    form.set("game", name);
    startTransition(() => saveGame(clipId, form));
  }

  return (
    <div className="flex flex-col gap-1">
      <GamePicker
        label="Game"
        initial={initial}
        initialPick={coverPath === undefined ? undefined : { cover: coverPath && coverPublicPath(coverPath) }}
        pending={pending}
        onPickLocal={(game) => saveText(game.name)}
        onSubmitText={saveText}
        // Typed but not picked: leaving the box saves it, as on the upload page.
        onBlurText={(text) => text !== initial && saveText(text)}
        onPickIgdb={(game) =>
          startTransition(async () => {
            const result = await pickIgdbGame(clipId, game.igdbId);
            setError(result.ok ? null : result.error);
          })
        }
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
