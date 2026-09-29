import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { clips, users } from "@/db/schema";
import type { CommentRow } from "@/db/comments";
import { getClipMetadata } from "@/db/metadata";
import { like, likeCount, unlike } from "@/db/likes";
import { notify, retractLike } from "@/db/notifications";
import { listProfiles } from "@/db/profiles";
import { recordActivity } from "@/db/activity";
import { announceComment } from "@/lib/events/social";
import { publish } from "@/lib/realtime/publish";
import type { ReportedEvent } from "@/lib/realtime/envelope";
import { extractMentions } from "./mentions";
import { recipientsFor, type SocialEvent } from "./recipients";

/**
 * The one place that combines database writes, who-gets-notified and
 * publishing. Every write happens before any publish, and publish never
 * throws, so realtime being down costs only the live update.
 */

function userIdOf(db: Db, username: string): string | undefined {
  return db.select({ id: users.id }).from(users).where(eq(users.authentikUsername, username)).get()?.id;
}

function usernameOf(db: Db, userId: string): string | undefined {
  return db.select({ u: users.authentikUsername }).from(users).where(eq(users.id, userId)).get()?.u;
}

function uploaderOf(db: Db, clipId: string): string | null {
  const row = db
    .select({ username: users.authentikUsername })
    .from(clips)
    .leftJoin(users, eq(clips.uploaderId, users.id))
    .where(eq(clips.id, clipId))
    .get();
  return row?.username ?? null;
}

function knownUsernames(db: Db): Set<string> {
  return new Set(listProfiles(db).map((p) => p.username));
}

async function deliver(
  db: Db,
  event: SocialEvent,
  clipId: string,
  extra: { commentId?: string; positionMs?: number | null; source?: "comment" | "chat" } = {},
): Promise<void> {
  for (const { username, type } of recipientsFor(event)) {
    const recipientId = userIdOf(db, username);
    if (!recipientId) continue;
    const notification = notify(db, { recipientId, type, clipId, actor: event.actor, ...extra });
    if (notification) await publish({ t: "notification", notification }, undefined, { to: username });
  }
}

export async function onComment(db: Db, comment: CommentRow): Promise<void> {
  await announceComment(comment);
  await deliver(
    db,
    {
      kind: "comment",
      actor: comment.user,
      uploader: uploaderOf(db, comment.clipId),
      participants: getClipMetadata(db, comment.clipId).participants,
      mentioned: extractMentions(comment.body, knownUsernames(db), comment.user),
    },
    comment.clipId,
    { commentId: comment.id, positionMs: comment.positionMs, source: "comment" },
  );
}

function readyPassDone(db: Db, clipId: string): boolean {
  return db.select({ done: clips.peopleNotified }).from(clips).where(eq(clips.id, clipId)).get()?.done ?? false;
}

/** Tells the people newly added as participants — once the clip is watchable. */
export async function onParticipantsChanged(
  db: Db,
  clipId: string,
  actor: string,
  before: string[],
  after: string[],
): Promise<void> {
  // Until the clip's first ready, onClipReady will tell everyone at once.
  // After it (a reprocess included) tags notify as they happen.
  if (!readyPassDone(db, clipId)) return;
  const added = after.filter((u) => !before.includes(u));
  await deliver(db, { kind: "tagged", actor, added }, clipId);
}

/**
 * The clip just became ready: tag everyone in it, the first time only. The
 * conditional update is the claim, so two runners can't both notify, and a
 * reprocess reaching ready again sends nothing.
 */
export async function onClipReady(db: Db, clipId: string): Promise<void> {
  const claimed = db
    .update(clips)
    .set({ peopleNotified: true })
    .where(and(eq(clips.id, clipId), eq(clips.peopleNotified, false)))
    .returning({ id: clips.id })
    .get();
  if (!claimed) return;
  const participants = getClipMetadata(db, clipId).participants;
  if (participants.length === 0) return;
  await deliver(db, { kind: "tagged", actor: uploaderOf(db, clipId) ?? "", added: participants }, clipId);
}

export async function onLike(
  db: Db,
  actorId: string,
  clipId: string,
): Promise<{ status: "liked" | "already" | "own" | "missing"; count: number }> {
  const status = like(db, actorId, clipId);
  const count = likeCount(db, clipId);
  // Only a like that changed something is announced: a double click is one like.
  if (status === "liked") {
    await publish({ t: "clip.likes", clipId, count });
    const actor = usernameOf(db, actorId);
    if (actor) await deliver(db, { kind: "like", actor, uploader: uploaderOf(db, clipId) }, clipId);
  }
  return { status, count };
}

export async function onUnlike(db: Db, actorId: string, clipId: string): Promise<{ count: number }> {
  if (!unlike(db, actorId, clipId)) return { count: likeCount(db, clipId) };

  const count = likeCount(db, clipId);
  await publish({ t: "clip.likes", clipId, count });
  const actor = usernameOf(db, actorId);
  const uploader = uploaderOf(db, clipId);
  const recipientId = uploader ? userIdOf(db, uploader) : undefined;
  if (actor && uploader && recipientId && uploader !== actor) {
    const result = retractLike(db, { recipientId, clipId, actor });
    // A removed group simply disappears on the next tray load; nothing is announced.
    if (result && result !== "deleted") await publish({ t: "notification", notification: result }, undefined, { to: uploader });
  }
  return { count };
}

/** A report from realtime. False when it was dropped (unknown user or clip, nothing playing). */
export async function onTheaterEvent(db: Db, event: ReportedEvent): Promise<boolean> {
  const actorId = userIdOf(db, event.user);
  if (!actorId) return false;

  switch (event.kind) {
    case "theater.play":
      return recordActivity(db, { type: "theater_play", userId: actorId, clipId: event.clipId, at: event.at });
    case "theater.reaction":
      return event.clipId
        ? recordActivity(db, { type: "reaction", userId: actorId, clipId: event.clipId, at: event.at })
        : false;
    case "theater.chat": {
      // Notifications link to a clip; a mention with nothing playing is dropped.
      if (!event.clipId) return false;
      if (!db.select({ id: clips.id }).from(clips).where(eq(clips.id, event.clipId)).get()) return false;
      const mentioned = extractMentions(event.body, knownUsernames(db), event.user);
      await deliver(db, { kind: "chat", actor: event.user, mentioned }, event.clipId, { source: "chat" });
      return true;
    }
  }
}

export const BULK_THRESHOLD = 3;

/**
 * People a bulk edit added. Only clips whose ready pass has run count (the
 * rest are told at ready); more than BULK_THRESHOLD of them makes one summary
 * rather than a notification per clip. Never the editor.
 */
export async function onBulkTagged(db: Db, actor: string, added: Map<string, string[]>): Promise<void> {
  for (const [username, clipIds] of added) {
    if (username === actor) continue;
    const ready = clipIds.filter((id) => readyPassDone(db, id));
    if (ready.length === 0) continue;
    if (ready.length <= BULK_THRESHOLD) {
      for (const clipId of ready) await deliver(db, { kind: "tagged", actor, added: [username] }, clipId);
      continue;
    }
    const recipientId = userIdOf(db, username);
    if (!recipientId) continue;
    const notification = notify(db, { recipientId, type: "tagged_bulk", clipId: ready[0], actor, count: ready.length });
    if (notification) await publish({ t: "notification", notification }, undefined, { to: username });
  }
}
