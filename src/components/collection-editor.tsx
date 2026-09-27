"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createCollectionAction,
  deleteCollectionAction,
  setCollectionOpen,
  updateCollectionAction,
} from "@/app/collections/actions";
import type { Fields } from "@/lib/collections/commands";
import { DESCRIPTION_MAX, NAME_MAX } from "@/lib/collections/validate";

/**
 * The name/description form. `create` also has the open switch and goes to
 * the new collection; `edit` saves in place and calls `onDone`.
 */
export function CollectionEditor({
  mode,
  collection,
  onDone,
}: {
  mode: "create" | "edit";
  collection?: { id: string; name: string; description: string | null };
  onDone?(): void;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="collection-editor"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          const result =
            mode === "create"
              ? await createCollectionAction(formData)
              : await updateCollectionAction(collection!.id, formData);

          if (!result.ok) {
            setFields(result.fields ?? {});
            if (!result.fields) setError(result.error);
            return;
          }

          setFields({});
          if (mode === "create" && "id" in result) {
            router.push(`/collections/${result.id}`);
          } else {
            router.refresh();
            onDone?.();
          }
        })
      }
    >
      <label className="collection-field">
        <span>Name</span>
        <input
          name="name"
          className="title-input"
          required
          maxLength={NAME_MAX * 2}
          defaultValue={collection?.name}
          placeholder="Kobe fails"
          aria-invalid={fields.name ? true : undefined}
          autoFocus
        />
        {fields.name && <span className="collection-field-error">{fields.name}</span>}
      </label>
      <label className="collection-field">
        <span>Description <span className="text-ink-muted">(optional)</span></span>
        <textarea
          name="description"
          className="title-input"
          rows={2}
          maxLength={DESCRIPTION_MAX * 2}
          defaultValue={collection?.description ?? ""}
          aria-invalid={fields.description ? true : undefined}
        />
        {fields.description && <span className="collection-field-error">{fields.description}</span>}
      </label>
      {mode === "create" && (
        <label className="collection-switch">
          <input type="checkbox" name="open" />
          Let anyone add
        </label>
      )}
      {error && <p className="collection-field-error">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="button-primary" disabled={pending}>
          {mode === "create" ? "Create" : "Save"}
        </button>
        {onDone && (
          <button type="button" className="button-secondary" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** The New collection button on /collections, revealing the form. */
export function NewCollection() {
  const [open, setOpen] = useState(false);

  return open ? (
    <div className="collection-panel">
      <CollectionEditor mode="create" onDone={() => setOpen(false)} />
    </div>
  ) : (
    <button type="button" className="button-primary" onClick={() => setOpen(true)}>
      New collection
    </button>
  );
}

/** Edit, the open switch and Delete: the owner's controls on a collection page. */
export function CollectionOwnerControls({
  collection,
}: {
  collection: { id: string; name: string; description: string | null; open: boolean };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(collection.open);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Follow the server once a refresh lands (another tab, or our own save).
  const [seen, setSeen] = useState(collection.open);
  if (seen !== collection.open) {
    setSeen(collection.open);
    setOpen(collection.open);
  }

  function toggleOpen(next: boolean) {
    setOpen(next);
    setError(null);
    startTransition(async () => {
      const result = await setCollectionOpen(collection.id, next);
      if (!result.ok) {
        setOpen(!next);
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteCollectionAction(collection.id);
      if (result.ok) {
        router.push("/collections");
      } else {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  if (editing) {
    return (
      <div className="collection-panel mt-4">
        <CollectionEditor mode="edit" collection={collection} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" className="button-secondary" onClick={() => setEditing(true)}>
        Edit
      </button>
      <label className="collection-switch">
        <input
          type="checkbox"
          checked={open}
          disabled={pending}
          onChange={(event) => toggleOpen(event.target.checked)}
        />
        Let anyone add
      </label>
      {confirming ? (
        <span className="flex items-center gap-2 text-sm">
          Delete this collection? The clips stay.
          <button type="button" className="button-danger" disabled={pending} onClick={remove}>
            Delete
          </button>
          <button type="button" className="button-secondary" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </span>
      ) : (
        <button type="button" className="button-secondary" onClick={() => setConfirming(true)}>
          Delete
        </button>
      )}
      {error && <p className="collection-field-error w-full">{error}</p>}
    </div>
  );
}
