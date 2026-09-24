"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { addComment, softDeleteComment } from "@/db/comments";
import { setClipGame, setClipParticipants, setClipTags } from "@/db/metadata";
import { announceComment } from "@/lib/events/social";
import { normalizeChatText } from "@/lib/realtime/chat";
import { requireUser } from "@/lib/session";

/**
 * The first server actions in this repo.
 *
 * Every one of them calls `requireUser` itself. A server action is a public
 * HTTP endpoint with a generated name — the page having checked identity says
 * nothing about who is calling this.
 */
export async function postComment(clipId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  // The same validator the chat composer uses: trimmed, collapsed, capped.
  const body = normalizeChatText(formData.get("body"));

  if (body === null) {
    return;
  }

  const comment = addComment(getDb(), { clipId, userId: user.id, body });
  revalidatePath(`/clips/${clipId}`);
  await announceComment(comment);
}

export async function removeComment(clipId: string, commentId: string): Promise<void> {
  const user = await requireUser();
  // softDeleteComment refuses when the caller is not the author, so the
  // authorization lives in one place rather than here as well.
  softDeleteComment(getDb(), commentId, user.id);
  revalidatePath(`/clips/${clipId}`);
}

/**
 * Metadata is communal: anyone signed in may retag any clip.
 *
 * This is a private site for a fixed group of friends. Per-clip ownership
 * checks would cost more in friction than they could possibly prevent — but
 * `requireUser` still runs, because a server action is a public endpoint.
 *
 * Both paths revalidate: the clip page shows the metadata, and the grid
 * filters on it.
 */
export async function saveTags(clipId: string, formData: FormData): Promise<void> {
  await requireUser();
  setClipTags(getDb(), clipId, String(formData.get("tags") ?? "").split(","));
  revalidatePath(`/clips/${clipId}`);
  revalidatePath("/");
}

export async function saveGame(clipId: string, formData: FormData): Promise<void> {
  await requireUser();
  const raw = String(formData.get("game") ?? "").trim();
  setClipGame(getDb(), clipId, raw.length === 0 ? null : raw);
  revalidatePath(`/clips/${clipId}`);
  revalidatePath("/");
}

export async function saveParticipants(clipId: string, formData: FormData): Promise<void> {
  await requireUser();
  setClipParticipants(getDb(), clipId, String(formData.get("participants") ?? "").split(","));
  revalidatePath(`/clips/${clipId}`);
  revalidatePath("/");
}
