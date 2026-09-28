"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import {
  deleteTag,
  mergeTags,
  renameGame,
  renameTag,
  type DeleteResult,
  type RenameResult,
} from "@/db/admin/games-tags";
import { reprocessClip, updateClipTitle } from "@/db/admin/clips";
import { cancelJob, getAdminJob, retryJob } from "@/db/admin/jobs";
import { getClip } from "@/db/clips";
import { jobs } from "@/db/schema";
import { getClipMetadata, setClipGame, setClipParticipants, setClipTags, type ClipMetadata } from "@/db/metadata";
import { listUsernames } from "@/db/users";
import { resetName } from "@/db/admin/users";
import { getProfile } from "@/db/profiles";
import { removePicture } from "@/lib/profiles/picture-store";
import { ensureReprocessSource } from "@/lib/admin/reprocess";
import { announceClipUpdated } from "@/lib/events/clips";
import { publish } from "@/lib/realtime/publish";
import { onParticipantsChanged } from "@/lib/social/events";
import { requireAdmin } from "@/lib/session";
import { deleteGameWithCover, linkGameToIgdb, mergeGamesWithCovers } from "@/lib/games/link";
import { getIgdb } from "@/lib/igdb";
import { eq } from "drizzle-orm";

/**
 * The admin page's server actions.
 *
 * Every one calls `requireAdmin()` as its first statement, before it reads or
 * writes anything (a test holds each export to that). A server action is a
 * public HTTP endpoint with a generated name: the page's 404 for non-admins
 * says nothing about who is calling this.
 *
 * Arguments are whatever the client sent, so each is narrowed rather than
 * trusted.
 */

type MergeResult = { ok: true; moved: number } | { ok: false; error: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function merged(run: () => number): MergeResult {
  try {
    return { ok: true, moved: run() };
  } catch (error) {
    // SelfMergeError and "the target is gone" carry their own messages.
    return { ok: false, error: error instanceof Error ? error.message : "Merge failed." };
  }
}

export async function renameGameAction(id: unknown, name: unknown): Promise<RenameResult> {
  await requireAdmin();
  const result = renameGame(getDb(), text(id), text(name));
  revalidatePath("/admin");
  return result;
}

export async function mergeGamesAction(fromId: unknown, intoId: unknown): Promise<MergeResult> {
  await requireAdmin();
  const result = merged(() => mergeGamesWithCovers(getDb(), process.env, text(fromId), text(intoId)));
  revalidatePath("/admin");
  return result;
}

export async function deleteGameAction(id: unknown, force: unknown): Promise<DeleteResult> {
  await requireAdmin();
  const result = deleteGameWithCover(getDb(), process.env, text(id), { force: force === true });
  revalidatePath("/admin");
  return result;
}

export async function linkGameAction(gameId: unknown, igdbId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const igdb = getIgdb();
  if (!igdb || typeof igdbId !== "number" || !Number.isInteger(igdbId)) {
    return { ok: false, error: "IGDB isn't available." };
  }
  const result = await linkGameToIgdb(getDb(), process.env, igdb, text(gameId), igdbId);
  revalidatePath("/admin");
  revalidatePath("/");
  return result.ok ? { ok: true } : result;
}

export async function renameTagAction(id: unknown, name: unknown): Promise<RenameResult> {
  await requireAdmin();
  const result = renameTag(getDb(), text(id), text(name));
  revalidatePath("/admin");
  return result;
}

export async function mergeTagsAction(fromId: unknown, intoId: unknown): Promise<MergeResult> {
  await requireAdmin();
  const result = merged(() => mergeTags(getDb(), text(fromId), text(intoId)));
  revalidatePath("/admin");
  return result;
}

export async function deleteTagAction(id: unknown, force: unknown): Promise<DeleteResult> {
  await requireAdmin();
  const result = deleteTag(getDb(), text(id), { force: force === true });
  revalidatePath("/admin");
  return result;
}

type Outcome = { ok: true } | { ok: false; error: string };

function list(value: unknown): string[] {
  return text(value).split(",");
}

function revalidateClip(clipId: string): void {
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/clips/${clipId}`);
}

/** What the inline editor starts from: the clip's metadata and who can be in it. */
export async function clipEditDataAction(
  clipId: unknown,
): Promise<{ metadata: ClipMetadata; knownUsers: string[] } | null> {
  await requireAdmin();
  const db = getDb();
  const id = text(clipId);

  if (!getClip(db, id)) {
    return null;
  }

  return { metadata: getClipMetadata(db, id), knownUsers: listUsernames(db) };
}

/**
 * The admin's inline clip editor: title, game, tags and participants in one
 * save, through the same writes the clip page uses (each reindexes search),
 * then one `clip.updated` so open grids redraw the card.
 */
export async function updateClipAction(clipId: unknown, fields: unknown): Promise<Outcome> {
  const admin = await requireAdmin();
  const db = getDb();
  const id = text(clipId);
  const input = (typeof fields === "object" && fields !== null ? fields : {}) as Record<string, unknown>;

  if (!getClip(db, id)) {
    return { ok: false, error: "That clip is gone." };
  }

  const titled = updateClipTitle(db, id, text(input.title));

  if (!titled.ok) {
    return titled;
  }

  const game = text(input.game).trim();
  setClipGame(db, id, game.length === 0 ? null : game);
  setClipTags(db, id, list(input.tags));
  const before = getClipMetadata(db, id).participants;
  const after = setClipParticipants(db, id, list(input.participants));

  revalidateClip(id);
  await announceClipUpdated(db, id);
  await onParticipantsChanged(db, id, admin.authentikUsername, before, after);
  return { ok: true };
}

/**
 * Runs a clip's pipeline again from probe. Refused while it has a job queued
 * or running, and when there's no file left on disk to run it on.
 */
export async function reprocessClipAction(clipId: unknown): Promise<Outcome> {
  await requireAdmin();
  const db = getDb();
  const id = text(clipId);

  if (!getClip(db, id)) {
    return { ok: false, error: "That clip is gone." };
  }

  if (!ensureReprocessSource(process.env, id)) {
    return { ok: false, error: "The source file is gone, so there's nothing to reprocess. Upload it again." };
  }

  const result = reprocessClip(db, id);

  if (result.ok) {
    revalidateClip(id);
    await announceClipUpdated(db, id);
    const queued = db.select({ id: jobs.id }).from(jobs).where(eq(jobs.clipId, id)).get();
    const job = queued ? getAdminJob(db, queued.id) : null;
    if (job) {
      await publish({ t: "job.updated", job });
    }
  }

  return result;
}

async function announceJob(id: string): Promise<void> {
  const db = getDb();
  const job = getAdminJob(db, id);

  if (job) {
    await publish({ t: "job.updated", job });
    await announceClipUpdated(db, job.clipId);
  }
}

/** A failed job back into the queue, attempts as they were. */
export async function retryJobAction(jobId: unknown): Promise<Outcome> {
  await requireAdmin();
  const id = text(jobId);

  if (!retryJob(getDb(), id)) {
    return { ok: false, error: "Only a failed job can be retried." };
  }

  revalidatePath("/admin");
  await announceJob(id);
  return { ok: true };
}

/** Someone's chosen name back to their Authentik one. Their clips are reindexed. */
export async function resetNameAction(username: unknown): Promise<Outcome> {
  await requireAdmin();
  const db = getDb();
  const name = text(username);

  if (!getProfile(db, name)) {
    return { ok: false, error: "No such user." };
  }

  const profile = resetName(db, name);
  revalidatePath("/admin");
  await publish({ t: "profile.updated", profile });
  return { ok: true };
}

/** The same removal as the person's own: files deleted, back to the initial. */
export async function removePictureAction(username: unknown): Promise<Outcome> {
  await requireAdmin();
  const db = getDb();
  const name = text(username);

  if (!getProfile(db, name)) {
    return { ok: false, error: "No such user." };
  }

  const profile = await removePicture(db, name);
  revalidatePath("/admin");
  await publish({ t: "profile.updated", profile });
  return { ok: true };
}

/** A queued job to failed, "cancelled by admin". A running one can't be stopped. */
export async function cancelJobAction(jobId: unknown): Promise<Outcome> {
  await requireAdmin();
  const id = text(jobId);

  if (!cancelJob(getDb(), id)) {
    return { ok: false, error: "Only a queued job can be cancelled." };
  }

  revalidatePath("/admin");
  await announceJob(id);
  return { ok: true };
}
