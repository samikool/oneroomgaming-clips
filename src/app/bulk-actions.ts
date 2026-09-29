"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { applyBulkEdit, selectionSummary, type ResolvedGame, type SelectionSummary } from "@/db/bulk";
import { parseBulkChanges, parseIds, MAX_IDS } from "@/lib/clips/bulk-changes";
import { announceClipsUpdated } from "@/lib/events/clips";
import { ensureIgdbGame } from "@/lib/games/link";
import { getIgdb } from "@/lib/igdb";
import { requireUser } from "@/lib/session";
import { onBulkTagged } from "@/lib/social/events";

/**
 * Bulk edit from the clip browser. Metadata is communal, so any signed-in
 * user may; each action still calls requireUser first — a server action is a
 * public endpoint.
 */
const tooMany = `Select at most ${MAX_IDS} clips.`;

export async function selectionSummaryAction(ids: unknown): Promise<SelectionSummary | { error: string }> {
  await requireUser();
  const list = parseIds(ids);
  if (!list) return { error: tooMany };
  return selectionSummary(getDb(), list);
}

export async function bulkEditAction(
  ids: unknown,
  changes: unknown,
): Promise<
  { ok: true; updated: number; skipped: number; gameDropped: boolean; unknownPeople: string[] } | { ok: false; error: string }
> {
  const user = await requireUser();
  const list = parseIds(ids);
  if (!list) return { ok: false, error: tooMany };
  const parsed = parseBulkChanges(changes);
  const db = getDb();

  let game: ResolvedGame = { op: "leave" };
  let gameDropped = false;
  const g = parsed.game;
  if (g.op === "clear") game = { op: "clear" };
  else if (g.op === "local") game = { op: "id", gameId: g.id };
  else if (g.op === "text") game = { op: "name", name: g.name };
  else if (g.op === "igdb") {
    const igdb = getIgdb();
    const id = igdb ? await ensureIgdbGame(db, process.env, igdb, g.igdbId) : null;
    if (id) game = { op: "id", gameId: id };
    else gameDropped = true;
  }

  const result = applyBulkEdit(db, list, { ...parsed, game });
  await announceClipsUpdated(db, result.updated);
  await onBulkTagged(db, user.authentikUsername, result.added);
  revalidatePath("/");
  return { ok: true, updated: result.updated.length, skipped: result.skipped, gameDropped, unknownPeople: result.unknownPeople };
}
