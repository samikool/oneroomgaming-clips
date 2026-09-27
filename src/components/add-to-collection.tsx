"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { addToCollection, createCollectionWithClip, removeFromCollection } from "@/app/collections/actions";
import type { CollectionChoice } from "@/db/collections";
import { canCollection } from "@/lib/collections/permissions";
import { UserName } from "./user-name";

/**
 * Add a clip to collections: a popover of every collection you can add to,
 * each ticked when it already holds the clip. Ticking adds at the end,
 * unticking removes (where you're allowed), and a name + Enter makes a new
 * collection with the clip in it. Optimistic, rolling back with a message.
 *
 * `compact` is the browser card's ⋯. Its clicks never bubble, so the card
 * doesn't open underneath.
 */
export function AddToCollection({ clipId, compact = false }: { clipId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [choices, setChoices] = useState<CollectionChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const wrapper = useRef<HTMLSpanElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);

  // The sliding browser clips its panels. A top-layer popover remains usable
  // on the final row and on narrow screens without changing the slide layout.
  useLayoutEffect(() => {
    const panel = popover.current;
    const anchor = wrapper.current;
    if (!open || !panel || !anchor) return;
    panel.showPopover();
    const place = () => {
      const box = anchor.getBoundingClientRect();
      panel.style.left = `${Math.max(16, Math.min(box.left, window.innerWidth - panel.offsetWidth - 16))}px`;
      panel.style.top = `${Math.max(16, Math.min(box.bottom + 6, window.innerHeight - panel.offsetHeight - 16))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChoices(null);
    setFailed(false);
    fetch(`/api/collections/for-clip/${clipId}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { me: string; collections: CollectionChoice[] }) => {
        if (cancelled) return;
        setMe(data.me);
        setChoices(data.collections);
      })
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
  }, [open, clipId]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4_000);
    return () => clearTimeout(timer);
  }, [error]);

  function setContains(id: string, contains: boolean) {
    setChoices((current) =>
      current?.map((c) => (c.id === id ? { ...c, contains, addedBy: contains ? me : null } : c)) ?? null,
    );
  }

  async function toggle(choice: CollectionChoice) {
    const adding = !choice.contains;
    setError(null);
    setContains(choice.id, adding);
    setBusy(choice.id);
    try {
      const result = adding
        ? await addToCollection(choice.id, clipId)
        : await removeFromCollection(choice.id, clipId);
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      setChoices((current) => current?.map((c) => (c.id === choice.id ? choice : c)) ?? null);
      setError(error instanceof Error ? error.message : "Couldn't update that collection.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating || !me) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createCollectionWithClip(trimmed, clipId);
      if (!result.ok) {
        setError(result.fields?.name ?? result.error);
        return;
      }
      setName("");
      setChoices((current) => [
        { id: result.id, name: trimmed, owner: me, open: false, contains: true, addedBy: me },
        ...(current ?? []),
      ]);
    } catch {
      setError("Couldn't create that collection. Try again.");
    } finally {
      setCreating(false);
    }
  }

  // Everything inside stays inside: on a card, a click must not open the clip.
  const contain = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <span ref={wrapper} className="collect" onClick={contain} onPointerDown={contain}>
      <button
        type="button"
        className={compact ? "card-menu-toggle" : "collect-toggle"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={compact ? "More: add to collection" : undefined}
        title={compact ? "Add to collection" : undefined}
        onClick={(event) => {
          event.preventDefault();
          setOpen((o) => !o);
        }}
      >
        {compact ? "⋯" : "Add to collection"}
      </button>
      {open && (
        <div ref={popover} popover="manual" style={{ position: "fixed", margin: 0, right: "auto", bottom: "auto", maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }} className="collect-popover" role="dialog" aria-label="Add to collection">
          {compact && <p className="collect-note">Add to collection</p>}
          {failed ? (
            <p className="collect-note">Couldn&apos;t load your collections.</p>
          ) : choices === null ? (
            <p className="collect-note">Loading…</p>
          ) : choices.length === 0 ? (
            <p className="collect-note">No collections you can add to yet.</p>
          ) : (
            <ul className="collect-list">
              {choices.map((choice) => {
                const isOwner = choice.owner === me;
                const removable = canCollection("remove", {
                  isOwner,
                  open: choice.open,
                  addedByMe: choice.addedBy === me,
                });

                return (
                  <li key={choice.id}>
                    <label className="collect-row">
                      <input
                        type="checkbox"
                        checked={choice.contains}
                        disabled={busy !== null || (choice.contains && !removable)}
                        onChange={() => void toggle(choice)}
                      />
                      <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                      {!isOwner && <UserName username={choice.owner} variant="compact" link={false} />}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="collect-new"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <input
              className="share-link"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="+ New collection"
              aria-label="New collection name"
              maxLength={60}
              disabled={creating}
            />
          </form>
          {error && <p role="alert" className="collection-field-error mt-2">{error}</p>}
        </div>
      )}
    </span>
  );
}
