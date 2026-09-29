"use client";

import { useState } from "react";
import { GamePicker } from "@/components/game-picker";
import { gameCover } from "@/lib/games/picker";
import { effectivePeople, type BatchItem, type Group } from "@/lib/uploads/batch";
import { fromLocalInput, toLocalInput, type GameChoice } from "@/lib/uploads/infer";
import { useUploads } from "@/lib/uploads/provider";

/** A chosen game shows its art in the box; typed text does not. */
const pickOf = (game: GameChoice | null | undefined) => (game && game.kind !== "text" ? { cover: game.cover ?? null } : undefined);

const list = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

/** The review list: one block per folder, clips inherit the block's fields. */
export function StagedGroups() {
  const { batch, start } = useUploads();
  const staged = batch.items.filter((i) => i.phase === "staged");
  if (staged.length === 0) return null;

  return (
    <section className="mt-8" aria-label="Ready to upload">
      <div className="mb-4 flex justify-end">
        <button type="button" className="button-primary" onClick={start}>
          Upload {staged.length} clip{staged.length === 1 ? "" : "s"}
        </button>
      </div>
      <div className="flex flex-col gap-6">
        {batch.groups
          .filter((g) => staged.some((i) => i.folder === g.folder))
          .map((group) => (
            <GroupBlock key={group.folder || "(loose)"} group={group} items={staged.filter((i) => i.folder === group.folder)} />
          ))}
      </div>
    </section>
  );
}

function GroupBlock({ group, items }: { group: Group; items: BatchItem[] }) {
  const { setGroup, touchGroup } = useUploads();
  const choose = (game: GameChoice | null) => setGroup(group.folder, { game });
  // Typed but not picked: leaving the box keeps it as a free-text game, so
  // pressing Upload straight after typing still sends what the box shows.
  const keepTyped = (text: string) => {
    const typed = text.trim();
    if (typed !== (group.game?.name ?? "")) choose(typed ? { kind: "text", name: typed } : null);
  };

  return (
    <div className="upload-group">
      <header className="upload-group-head">
        <h3 className="font-display text-lg">
          {group.folder || "Loose files"} <span className="text-sm text-ink-muted">{items.length}</span>
        </h3>
        <div className="upload-group-fields">
          <div>
            <label className="metadata-label">
              Game {group.gameGuess && <span className="guess-badge">best guess</span>}
            </label>
            <GamePicker
              label={`Game for ${group.folder || "loose files"}`}
              initial={group.game?.name ?? ""}
              initialPick={pickOf(group.game)}
              onPickLocal={(g) => choose({ kind: "local", id: g.id, name: g.name, cover: gameCover(g) })}
              onPickIgdb={(g) => choose({ kind: "igdb", igdbId: g.igdbId, name: g.name, cover: gameCover(g) })}
              onSubmitText={(text) => choose(text ? { kind: "text", name: text } : null)}
              onTextChange={() => touchGroup(group.folder)}
              onBlurText={keepTyped}
            />
          </div>
          <label className="metadata-label">
            Tags
            <input
              className="title-input"
              defaultValue={group.tags.join(", ")}
              placeholder="ace, clutch"
              onBlur={(e) => setGroup(group.folder, { tags: list(e.target.value.toLowerCase()) })}
            />
          </label>
          <label className="metadata-label">
            People in every clip
            <input
              className="title-input"
              defaultValue={group.people.join(", ")}
              placeholder="sam, dave"
              onBlur={(e) => setGroup(group.folder, { people: list(e.target.value) })}
            />
          </label>
        </div>
      </header>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <ClipRow key={item.key} item={item} />
        ))}
      </ul>
    </div>
  );
}

function ClipRow({ item }: { item: BatchItem }) {
  const { batch, setTitle, setItem, cancel } = useUploads();
  const [more, setMore] = useState(false);
  const people = effectivePeople(batch, item);

  return (
    <li className="staged-item flex-col items-stretch">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`title-${item.key}`} className="mb-1 block truncate text-xs text-ink-muted">{item.path}</label>
          <input
            id={`title-${item.key}`}
            className="title-input"
            value={item.title}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setTitle(item.key, e.target.value)}
          />
        </div>
        <label className="w-52 text-xs text-ink-muted">
          Recorded
          <input
            type="datetime-local"
            className="title-input"
            value={toLocalInput(item.recordedAt)}
            onChange={(e) => setItem(item.key, { recordedAt: fromLocalInput(e.target.value) })}
          />
          {item.recordedAt === null && <span className="block">from video, if it has one</span>}
        </label>
        <button type="button" className="queue-action" aria-label={`Remove ${item.name}`} onClick={() => cancel(item.key)}>
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        {people.length > 0 && (
          <span>
            With {people.join(", ")} {item.peopleGuess && <span className="guess-badge">best guess</span>}
          </span>
        )}
        {item.game !== undefined && <span>Game: {item.game?.name ?? "none"}</span>}
        <button type="button" className="chip-button" onClick={() => setMore((m) => !m)}>
          {more ? "Done" : "Change people or game"}
        </button>
      </div>
      {more && (
        <div className="flex flex-col gap-2">
          <label className="metadata-label">
            People in this clip (besides the group's)
            <input
              className="title-input"
              defaultValue={item.people.join(", ")}
              onBlur={(e) => setItem(item.key, { people: list(e.target.value) })}
            />
          </label>
          <span className="metadata-label">Game for this clip only</span>
          <GamePicker
            label={`Game for ${item.title}`}
            initial={item.game?.name ?? ""}
            initialPick={pickOf(item.game)}
            onPickLocal={(g) => setItem(item.key, { game: { kind: "local", id: g.id, name: g.name, cover: gameCover(g) } })}
            onPickIgdb={(g) => setItem(item.key, { game: { kind: "igdb", igdbId: g.igdbId, name: g.name, cover: gameCover(g) } })}
            onSubmitText={(text) => setItem(item.key, { game: text ? { kind: "text", name: text } : undefined })}
          />
        </div>
      )}
    </li>
  );
}
