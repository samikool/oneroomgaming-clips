"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { bulkEditAction, selectionSummaryAction } from "@/app/bulk-actions";
import { GamePicker } from "@/components/game-picker";
import type { SelectionSummary } from "@/db/bulk";
import type { GameChange } from "@/lib/clips/bulk-changes";

const list = (text: string) => text.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Bulk edit for the selected clips: set or clear the game, add or remove tags and people. */
export function BulkEditDrawer({ ids, onClose, onSaved }: { ids: string[]; onClose(): void; onSaved(message: string): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [summary, setSummary] = useState<SelectionSummary | null>(null);
  const [error, setError] = useState("");
  const [game, setGame] = useState<GameChange & { label?: string }>({ op: "leave" });
  const [addTags, setAddTags] = useState("");
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [addPeople, setAddPeople] = useState("");
  const [removePeople, setRemovePeople] = useState<string[]>([]);
  const [pending, start] = useTransition();

  // Once, on open: the selection can't change while the drawer is up, and a
  // second showModal() on an open dialog throws.
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    void selectionSummaryAction(ids).then((s) => ("error" in s ? setError(s.error) : setSummary(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = summary?.total ?? ids.length;
  const readout = [
    game.op === "clear" ? `clear the game on ${total}` : game.op !== "leave" ? `set game to ${game.label} on ${total}` : "",
    list(addTags).length ? `add ${list(addTags).map((t) => `#${t}`).join(", ")} to ${total}` : "",
    ...removeTags.map((t) => `remove #${t} from ${summary?.tags.find((x) => x.name === t)?.count ?? 0}`),
    list(addPeople).length ? `add ${list(addPeople).join(", ")} to ${total}` : "",
    ...removePeople.map((p) => `remove ${p} from ${summary?.people.find((x) => x.username === p)?.count ?? 0}`),
  ].filter(Boolean);

  function save() {
    start(async () => {
      const { label: _, ...change } = game;
      const result = await bulkEditAction(ids, {
        game: change,
        addTags: list(addTags),
        removeTags,
        addPeople: list(addPeople),
        removePeople,
      });
      if (!result.ok) return setError(result.error);
      const bits = [`Updated ${plural(result.updated, "clip")}`];
      if (result.skipped) bits.push(`${result.skipped} no longer exist`);
      if (result.gameDropped) bits.push("IGDB didn't answer, so the game wasn't changed");
      if (result.unknownPeople.length) bits.push(`No one here is called ${result.unknownPeople.join(", ")}, so they weren't added`);
      onSaved(`${bits.join(". ")}.`);
    });
  }

  return (
    <dialog ref={dialog} className="bulk-drawer" onClose={onClose} aria-label={`Edit ${plural(total, "clip")}`}>
      <header className="flex items-center justify-between">
        <h2 className="text-xl">Edit {plural(total, "clip")}</h2>
        <button type="button" className="queue-action" aria-label="Close" onClick={() => dialog.current?.close()}>✕</button>
      </header>

      <section>
        <h3 className="metadata-label">Game</h3>
        {summary && (
          <p className="text-sm text-ink-muted">
            Now: {summary.games.map((g) => `${g.id ? g.name : "none"} ×${g.count}`).join(", ")}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" className={`chip-button${game.op === "leave" ? " chip-on" : ""}`} onClick={() => setGame({ op: "leave" })}>Leave as is</button>
          <button type="button" className={`chip-button${game.op === "clear" ? " chip-on" : ""}`} onClick={() => setGame({ op: "clear" })}>Clear game</button>
        </div>
        <GamePicker
          label="Set game for all"
          initial=""
          onPickLocal={(g) => setGame({ op: "local", id: g.id, label: g.name })}
          onPickIgdb={(g) => setGame({ op: "igdb", igdbId: g.igdbId, label: g.name })}
          onSubmitText={(t) => t.trim() && setGame({ op: "text", name: t.trim(), label: t.trim() })}
        />
      </section>

      <section>
        <h3 className="metadata-label">Tags</h3>
        <div className="flex flex-wrap gap-2">
          {summary?.tags.map((t) => (
            <button
              key={t.name}
              type="button"
              className={`chip-button${removeTags.includes(t.name) ? " chip-struck" : ""}`}
              aria-pressed={removeTags.includes(t.name)}
              onClick={() => setRemoveTags((r) => (r.includes(t.name) ? r.filter((x) => x !== t.name) : [...r, t.name]))}
            >
              #{t.name} {t.count}/{total} ✕
            </button>
          ))}
        </div>
        <input className="title-input" placeholder="Add tags: ace, clutch" value={addTags} onChange={(e) => setAddTags(e.target.value)} />
      </section>

      <section>
        <h3 className="metadata-label">People</h3>
        <div className="flex flex-wrap gap-2">
          {summary?.people.map((p) => (
            <button
              key={p.username}
              type="button"
              className={`chip-button${removePeople.includes(p.username) ? " chip-struck" : ""}`}
              aria-pressed={removePeople.includes(p.username)}
              onClick={() => setRemovePeople((r) => (r.includes(p.username) ? r.filter((x) => x !== p.username) : [...r, p.username]))}
            >
              {p.username} {p.count}/{total} ✕
            </button>
          ))}
        </div>
        <input className="title-input" placeholder="Add people: sam, dave" value={addPeople} onChange={(e) => setAddPeople(e.target.value)} />
      </section>

      {error && <p role="alert" className="text-danger">{error}</p>}

      <footer className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">{readout.length ? `Will ${readout.join("; ")}.` : "Nothing to change yet."}</p>
        <button type="button" className="button-primary" disabled={pending || readout.length === 0} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
      </footer>
    </dialog>
  );
}
