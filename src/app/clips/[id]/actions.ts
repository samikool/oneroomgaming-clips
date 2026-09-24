"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { addComment, softDeleteComment } from "@/db/comments";
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
