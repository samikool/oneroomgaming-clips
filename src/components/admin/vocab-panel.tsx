"use client";

import { useState, useTransition } from "react";
import {
  deleteGameAction,
  deleteTagAction,
  linkGameAction,
  mergeGamesAction,
  mergeTagsAction,
  renameGameAction,
  renameTagAction,
} from "@/app/admin/actions";
import { coverPublicPath } from "@/lib/media/paths";
import { GamePicker } from "../game-picker";

type Item = { id: string; name: string; slug?: string; clips: number; igdbId?: number | null; coverPath?: string | null };
type Kind = "game" | "tag";

const ACTIONS = {
  game: { rename: renameGameAction, merge: mergeGamesAction, remove: deleteGameAction },
  tag: { rename: renameTagAction, merge: mergeTagsAction, remove: deleteTagAction },
} as const;

function plural(n: number, word = "clip"): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Games and tags, side by side on a wide screen: rename, merge into another, delete. */
export function VocabPanel({ games, tags, igdbEnabled }: { games: Item[]; tags: Item[]; igdbEnabled: boolean }) {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <VocabList kind="game" title="Games" items={games} igdbEnabled={igdbEnabled} />
      <VocabList kind="tag" title="Tags" items={tags} />
    </div>
  );
}

function VocabList({
  kind,
  title,
  items,
  igdbEnabled = false,
}: {
  kind: Kind;
  title: string;
  items: Item[];
  igdbEnabled?: boolean;
}) {
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const shown = unlinkedOnly ? items.filter((item) => item.igdbId == null) : items;

  return (
    <div>
      <h2 className="mb-2 text-xl text-ink">
        {title} <span className="font-pixel text-xs text-ink-muted">{items.length}</span>
      </h2>
      {igdbEnabled && (
        <label className="mb-2 flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={unlinkedOnly} onChange={(event) => setUnlinkedOnly(event.target.checked)} />
          Not linked to IGDB only
        </label>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-ink-muted">None yet.</p>
      ) : (
        <ul className="admin-list">
          {shown.map((item) => (
            <VocabRow
              key={item.id}
              kind={kind}
              item={item}
              others={items.filter((other) => other.id !== item.id)}
              igdbEnabled={igdbEnabled}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

type Mode = { t: "idle" } | { t: "rename" } | { t: "link" } | { t: "merge"; into: string; confirming: boolean } | { t: "delete" };

function VocabRow({
  kind,
  item,
  others,
  igdbEnabled,
}: {
  kind: Kind;
  item: Item;
  others: Item[];
  igdbEnabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>({ t: "idle" });
  const [name, setName] = useState(item.name);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const actions = ACTIONS[kind];

  function done(error?: string) {
    setMessage(error ?? null);
    if (!error) {
      setMode({ t: "idle" });
    }
  }

  function rename() {
    startTransition(async () => {
      const result = await actions.rename(item.id, name);
      done(result.ok ? undefined : result.error);
    });
  }

  function merge(into: string) {
    startTransition(async () => {
      const result = await actions.merge(item.id, into);
      done(result.ok ? undefined : result.error);
    });
  }

  function remove(force: boolean) {
    startTransition(async () => {
      const result = await actions.remove(item.id, force);
      if (!result.ok) {
        // Someone tagged a clip with it since the page loaded: ask again, with the real count.
        setMode({ t: "delete" });
        setMessage(`Now used by ${plural(result.inUse)}.`);
        return;
      }
      done();
    });
  }

  const target = mode.t === "merge" ? others.find((o) => o.id === mode.into) : undefined;

  return (
    <li>
      {mode.t === "rename" ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            rename();
          }}
        >
          <input
            className="admin-input min-w-0 flex-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={`New name for ${item.name}`}
            autoFocus
          />
          <button type="submit" className="admin-small-button" disabled={pending}>
            Save
          </button>
          <button type="button" className="admin-small-button" onClick={() => setMode({ t: "idle" })}>
            Cancel
          </button>
        </form>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {item.coverPath && <img src={coverPublicPath(item.coverPath)} alt="" className="game-cover-sm" />}
          <span className="text-ink">{item.name}</span>
          {kind === "game" && igdbEnabled && item.igdbId == null && (
            <span className="font-pixel text-[10px] text-ink-muted">not linked</span>
          )}
          {item.slug !== undefined && <span className="ml-2 font-pixel text-[10px] text-ink-muted">{item.slug}</span>}
          <span className="ml-2 text-xs text-ink-muted">{plural(item.clips)}</span>
        </span>
      )}

      {mode.t === "idle" && (
        <span className="flex gap-1">
          <button
            type="button"
            className="admin-small-button"
            onClick={() => {
              setName(item.name);
              setMessage(null);
              setMode({ t: "rename" });
            }}
          >
            Rename
          </button>
          {kind === "game" && igdbEnabled && (
            <button
              type="button"
              className="admin-small-button"
              onClick={() => {
                setMessage(null);
                setMode({ t: "link" });
              }}
            >
              Link
            </button>
          )}
          {others.length > 0 && (
            <button
              type="button"
              className="admin-small-button"
              onClick={() => {
                setMessage(null);
                setMode({ t: "merge", into: others[0].id, confirming: false });
              }}
            >
              Merge into…
            </button>
          )}
          <button
            type="button"
            className="admin-small-button admin-small-danger"
            disabled={pending}
            onClick={() => {
              setMessage(null);
              // Unused goes straight away; used asks first.
              if (item.clips === 0) {
                remove(false);
              } else {
                setMode({ t: "delete" });
              }
            }}
          >
            Delete
          </button>
        </span>
      )}

      {mode.t === "link" && (
        <span className="flex w-full min-w-0 items-start gap-2">
          <GamePicker
            label={`IGDB game for ${item.name}`}
            initial={item.name}
            igdbOnly
            pending={pending}
            onPickIgdb={(game) =>
              startTransition(async () => {
                const result = await linkGameAction(item.id, game.igdbId);
                done(result.ok ? undefined : result.error);
              })
            }
          />
          <button type="button" className="admin-small-button" onClick={() => setMode({ t: "idle" })}>
            Cancel
          </button>
        </span>
      )}

      {mode.t === "merge" && (
        <span className="flex w-full flex-wrap items-center gap-2">
          {mode.confirming && target ? (
            <>
              <span className="text-sm">
                Move {plural(item.clips)} from “{item.name}” to “{target.name}” and delete “{item.name}”?
              </span>
              <button type="button" className="admin-small-button admin-small-danger" disabled={pending} onClick={() => merge(target.id)}>
                {pending ? "Merging…" : "Merge"}
              </button>
            </>
          ) : (
            <>
              <select
                className="admin-input"
                value={mode.into}
                onChange={(event) => setMode({ t: "merge", into: event.target.value, confirming: false })}
                aria-label={`Merge ${item.name} into`}
              >
                {others.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </select>
              <button type="button" className="admin-small-button" onClick={() => setMode({ ...mode, confirming: true })}>
                Next
              </button>
            </>
          )}
          <button type="button" className="admin-small-button" onClick={() => setMode({ t: "idle" })}>
            Cancel
          </button>
        </span>
      )}

      {mode.t === "delete" && (
        <span className="flex w-full flex-wrap items-center gap-2">
          <span className="text-sm">Used by {plural(item.clips)} — detach and delete?</span>
          <button type="button" className="admin-small-button admin-small-danger" disabled={pending} onClick={() => remove(true)}>
            {pending ? "Deleting…" : "Detach and delete"}
          </button>
          <button type="button" className="admin-small-button" onClick={() => setMode({ t: "idle" })}>
            Keep it
          </button>
        </span>
      )}

      {message && <span className="admin-message w-full">{message}</span>}
    </li>
  );
}
