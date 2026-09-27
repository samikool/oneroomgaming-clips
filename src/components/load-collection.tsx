"use client";

import { useEffect, useRef, useState } from "react";
import type { CollectionDetail, CollectionSummary } from "@/db/collections";
import { buildLoadList, loadSummary } from "@/lib/collections/load";
import type { ClientMessage } from "@/lib/realtime/envelope";

type Send = (message: ClientMessage) => void;

async function fetchCollection(id: string): Promise<CollectionDetail | null> {
  const response = await fetch(`/api/collections/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(String(response.status));
  return ((await response.json()) as { collection: CollectionDetail }).collection;
}

/**
 * Sends a collection's ready clips to the queue: `addMany` to append (anyone),
 * `load` to replace (the host). Clips still processing are counted and told
 * locally; the room tells the sender if the queue's limit cut it short.
 */
function sendCollection(send: Send, notify: (text: string) => void, detail: CollectionDetail, replace: boolean) {
  const { clips, skipped } = buildLoadList(detail);

  if (clips.length > 0) {
    send({
      t: "room.queue",
      op: replace ? "load" : "addMany",
      source: { collectionId: detail.id, name: detail.name },
      clips,
    });
  }

  const summary = loadSummary(skipped);
  if (summary) notify(summary);
}

type Prompt =
  | { kind: "loading" }
  | { kind: "ready"; detail: CollectionDetail; count: number }
  | { kind: "empty" | "missing" | "failed" };

/**
 * `/theater?load=<id>`, from a collection's Play in theater. The param is
 * taken and dropped from the URL at once; the prompt waits until this browser
 * is actually in the room, and never shows if the join doesn't land.
 */
export function LoadPrompt({
  joined,
  iAmHost,
  send,
  notify,
}: {
  joined: boolean;
  iAmHost: boolean;
  send: Send;
  notify(text: string): void;
}) {
  const pending = useRef<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("load");
    if (id === null) return;
    pending.current = id;
    url.searchParams.delete("load");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const id = pending.current;
    if (!joined || id === null) return;
    pending.current = null;
    setPrompt({ kind: "loading" });
    fetchCollection(id)
      .then((detail) => {
        if (!detail) return setPrompt({ kind: "missing" });
        const count = buildLoadList(detail).clips.length;
        setPrompt(count === 0 ? { kind: "empty" } : { kind: "ready", detail, count });
      })
      .catch(() => setPrompt({ kind: "failed" }));
  }, [joined]);

  if (prompt === null || prompt.kind === "loading") return null;

  const close = () => setPrompt(null);

  if (prompt.kind !== "ready") {
    return (
      <div className="load-prompt" role="status">
        <span className="load-prompt-text">
          {prompt.kind === "empty"
            ? "That collection is empty — nothing in it is ready to play."
            : prompt.kind === "missing"
              ? "That collection doesn't exist."
              : "Couldn't load that collection."}
        </span>
        <button type="button" className="button-secondary" onClick={close}>
          Close
        </button>
      </div>
    );
  }

  const choose = (replace: boolean) => {
    sendCollection(send, notify, prompt.detail, replace);
    close();
  };

  return (
    <div className="load-prompt" role="dialog" aria-label="Load collection">
      <span className="load-prompt-text">
        Load <em>{prompt.detail.name}</em> ({prompt.count} {prompt.count === 1 ? "clip" : "clips"})?
      </span>
      <button type="button" className="button-primary" onClick={() => choose(false)}>
        Append
      </button>
      {iAmHost && (
        <button type="button" className="button-secondary" onClick={() => choose(true)}>
          Replace queue
        </button>
      )}
      <button type="button" className="button-secondary" onClick={close}>
        Cancel
      </button>
    </div>
  );
}

/** The browse bar's Collections button: every collection, each with Append and (host) Replace. */
export function CollectionsButton({
  joined,
  iAmHost,
  send,
  notify,
}: {
  joined: boolean;
  iAmHost: boolean;
  send: Send;
  notify(text: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CollectionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const wrapper = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(false);
    fetch("/api/collections")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { collections: CollectionSummary[] }) => !cancelled && setList(data.collections))
      .catch(() => !cancelled && setFailed(true));

    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  async function choose(collection: CollectionSummary, replace: boolean) {
    setBusy(collection.id);
    try {
      const detail = await fetchCollection(collection.id);
      if (!detail) {
        notify("That collection doesn't exist any more.");
      } else if (buildLoadList(detail).clips.length === 0) {
        notify("That collection is empty — nothing in it is ready to play.");
      } else {
        sendCollection(send, notify, detail, replace);
        setOpen(false);
      }
    } catch {
      notify("Couldn't load that collection.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <span ref={wrapper} className="collect">
      <button
        type="button"
        className="collect-toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        Collections
      </button>
      {open && (
        <div className="load-popover collect-popover" role="dialog" aria-label="Load a collection">
          {!joined && <p className="collect-note">Join the room to queue a collection.</p>}
          {failed ? (
            <p className="collect-note">Couldn&apos;t load collections.</p>
          ) : list === null ? (
            <p className="collect-note">Loading…</p>
          ) : list.length === 0 ? (
            <p className="collect-note">No collections yet.</p>
          ) : (
            <ul className="load-list">
              {list.map((collection) => (
                <li key={collection.id} className="load-row">
                  <span className="load-row-name" title={collection.name}>
                    {collection.name}{" "}
                    <span className="text-xs text-ink-muted">{collection.clipCount}</span>
                  </span>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={!joined || busy !== null || collection.clipCount === 0}
                    onClick={() => void choose(collection, false)}
                  >
                    Append
                  </button>
                  {iAmHost && (
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={!joined || busy !== null || collection.clipCount === 0}
                      onClick={() => void choose(collection, true)}
                    >
                      Replace
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
