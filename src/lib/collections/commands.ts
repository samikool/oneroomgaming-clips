import type { Db } from "@/db/client";
import { getClip } from "@/db/clips";
import {
  addClip,
  createCollection,
  deleteCollection,
  getCollectionRow,
  getMembership,
  moveClip,
  removeClip,
  updateCollection,
} from "@/db/collections";
import type { User } from "@/db/schema";
import { canCollection, type CollectionAction } from "./permissions";
import { CollectionValidationError } from "./validate";

/**
 * Every collection mutation, with the permission check, as plain functions
 * of (db, actor). The server actions are thin wrappers that take the actor
 * from `requireUser()` and publish afterwards; keeping the rules here is what
 * lets them be tested without a request.
 */

export type Fields = Partial<Record<"name" | "description", string>>;
export type CommandResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; fields?: Fields };

export const DENIED = "You can't do that to this collection.";

const denied = { ok: false as const, error: DENIED };

function invalid(error: unknown): { ok: false; error: string; fields?: Fields } {
  if (error instanceof CollectionValidationError) {
    return { ok: false, error: error.message, fields: error.fields };
  }
  throw error;
}

/** Loads the collection and checks the actor may do `action` to it. */
function authorize(db: Db, actor: User, id: string, action: CollectionAction, clipId?: string): boolean {
  const row = getCollectionRow(db, id);

  if (!row) {
    return false;
  }

  const addedByMe = clipId === undefined ? undefined : getMembership(db, id, clipId)?.addedBy === actor.id;
  return canCollection(action, { isOwner: row.ownerId === actor.id, open: row.open, addedByMe });
}

export function createCollectionCommand(
  db: Db,
  actor: User,
  input: { name: string; description: string | null; open: boolean },
): CommandResult<{ id: string }> {
  try {
    return { ok: true, id: createCollection(db, actor.id, input).id };
  } catch (error) {
    return invalid(error);
  }
}

export function createCollectionWithClipCommand(
  db: Db,
  actor: User,
  name: string,
  clipId: string,
): CommandResult<{ id: string }> {
  if (!getClip(db, clipId)) {
    return { ok: false, error: "That clip no longer exists." };
  }

  try {
    return db.transaction(() => {
      const created = createCollection(db, actor.id, { name, open: false });
      addClip(db, created.id, clipId, actor.id);
      return { ok: true as const, id: created.id };
    });
  } catch (error) {
    return invalid(error);
  }
}

export function updateCollectionCommand(
  db: Db,
  actor: User,
  id: string,
  patch: { name?: string; description?: string | null },
): CommandResult {
  if (!authorize(db, actor, id, "edit")) {
    return denied;
  }

  try {
    updateCollection(db, id, patch);
    return { ok: true };
  } catch (error) {
    return invalid(error);
  }
}

export function setCollectionOpenCommand(db: Db, actor: User, id: string, open: boolean): CommandResult {
  if (!authorize(db, actor, id, "edit")) {
    return denied;
  }

  updateCollection(db, id, { open });
  return { ok: true };
}

export function deleteCollectionCommand(db: Db, actor: User, id: string): CommandResult {
  if (!authorize(db, actor, id, "delete")) {
    return denied;
  }

  deleteCollection(db, id);
  return { ok: true };
}

export function addToCollectionCommand(db: Db, actor: User, id: string, clipId: string): CommandResult {
  if (!authorize(db, actor, id, "add")) {
    return denied;
  }

  if (!getClip(db, clipId)) {
    return { ok: false, error: "That clip no longer exists." };
  }

  addClip(db, id, clipId, actor.id);
  return { ok: true };
}

export function removeFromCollectionCommand(db: Db, actor: User, id: string, clipId: string): CommandResult {
  if (!authorize(db, actor, id, "remove", clipId)) {
    return denied;
  }

  removeClip(db, id, clipId);
  return { ok: true };
}

export function moveInCollectionCommand(
  db: Db,
  actor: User,
  id: string,
  clipId: string,
  toIndex: number,
): CommandResult {
  if (!authorize(db, actor, id, "reorder") || !Number.isInteger(toIndex) || toIndex < 0) {
    return denied;
  }

  moveClip(db, id, clipId, toIndex);
  return { ok: true };
}
