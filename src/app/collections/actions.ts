"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import {
  addToCollectionCommand,
  createCollectionCommand,
  createCollectionWithClipCommand,
  deleteCollectionCommand,
  moveInCollectionCommand,
  removeFromCollectionCommand,
  setCollectionOpenCommand,
  updateCollectionCommand,
  type CommandResult,
} from "@/lib/collections/commands";
import { publish } from "@/lib/realtime/publish";
import { requireUser } from "@/lib/session";

/**
 * Collection mutations. Each one takes the actor from `requireUser()` — never
 * from its arguments — and the permission rules live in `commands.ts`. A
 * refusal comes back as `{ ok: false }`; nothing here throws to the client.
 */

async function after<T extends CommandResult<object>>(result: T, collectionId: string): Promise<T> {
  if (result.ok) {
    await publish({ t: "collection.updated", collectionId });
    revalidatePath("/collections");
    revalidatePath(`/collections/${collectionId}`);
  }
  return result;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createCollectionAction(formData: FormData): Promise<CommandResult<{ id: string }>> {
  const user = await requireUser();
  const result = createCollectionCommand(getDb(), user, {
    name: text(formData, "name"),
    description: text(formData, "description"),
    open: formData.get("open") === "on" || formData.get("open") === "true",
  });
  return result.ok ? after(result, result.id) : result;
}

export async function updateCollectionAction(id: string, formData: FormData): Promise<CommandResult> {
  const user = await requireUser();
  return after(
    updateCollectionCommand(getDb(), user, id, {
      name: text(formData, "name"),
      description: text(formData, "description"),
    }),
    id,
  );
}

export async function deleteCollectionAction(id: string): Promise<CommandResult> {
  const user = await requireUser();
  return after(deleteCollectionCommand(getDb(), user, id), id);
}

export async function setCollectionOpen(id: string, open: boolean): Promise<CommandResult> {
  const user = await requireUser();
  return after(setCollectionOpenCommand(getDb(), user, id, open === true), id);
}

export async function addToCollection(id: string, clipId: string): Promise<CommandResult> {
  const user = await requireUser();
  return after(addToCollectionCommand(getDb(), user, id, clipId), id);
}

export async function removeFromCollection(id: string, clipId: string): Promise<CommandResult> {
  const user = await requireUser();
  return after(removeFromCollectionCommand(getDb(), user, id, clipId), id);
}

export async function moveInCollection(id: string, clipId: string, toIndex: number): Promise<CommandResult> {
  const user = await requireUser();
  return after(moveInCollectionCommand(getDb(), user, id, clipId, toIndex), id);
}

export async function createCollectionWithClip(name: string, clipId: string): Promise<CommandResult<{ id: string }>> {
  const user = await requireUser();
  const result = createCollectionWithClipCommand(getDb(), user, String(name), clipId);
  return result.ok ? after(result, result.id) : result;
}
