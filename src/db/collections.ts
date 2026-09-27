import { and, asc, count, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { hydrateGridClips } from "./clips";
import { alias } from "drizzle-orm/sqlite-core";
import { clips, collectionClips, collections, likes, users } from "./schema";
import { toSummary } from "@/lib/events/clips";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { validateCollection } from "@/lib/collections/validate";

/** A collection as a card shows it. `owner` is the Authentik username. */
export type CollectionSummary = {
  id: string;
  name: string;
  description: string | null;
  open: boolean;
  owner: string;
  clipCount: number;
  /** The first four clips' thumbnails, in collection order. */
  thumbs: (string | null)[];
  updatedAt: number;
};

export type CollectionClip = ClipSummary & { addedBy: string; position: number };

export type CollectionDetail = CollectionSummary & { clips: CollectionClip[] };

export type CollectionChoice = {
  id: string;
  name: string;
  owner: string;
  open: boolean;
  contains: boolean;
  /** Who added this clip, when the collection holds it. */
  addedBy: string | null;
};

type Row = typeof collections.$inferSelect;

function summarise(db: Db, rows: Row[]): CollectionSummary[] {
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((r) => r.id);
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const owners = new Map(
    db
      .select({ id: users.id, name: users.authentikUsername })
      .from(users)
      .where(inArray(users.id, ownerIds))
      .all()
      .map((u) => [u.id, u.name] as const),
  );
  const counts = new Map(
    db
      .select({ id: collectionClips.collectionId, n: count() })
      .from(collectionClips)
      .where(inArray(collectionClips.collectionId, ids))
      .groupBy(collectionClips.collectionId)
      .all()
      .map((r) => [r.id, r.n] as const),
  );
  const thumbs = new Map<string, (string | null)[]>();

  for (const row of db
    .select({ id: collectionClips.collectionId, thumb: clips.thumbPath })
    .from(collectionClips)
    .innerJoin(clips, eq(collectionClips.clipId, clips.id))
    .where(and(inArray(collectionClips.collectionId, ids), sql`${collectionClips.position} < 4`))
    .orderBy(asc(collectionClips.position))
    .all()) {
    thumbs.set(row.id, [...(thumbs.get(row.id) ?? []), row.thumb]);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    open: row.open,
    owner: owners.get(row.ownerId) ?? "unknown",
    clipCount: counts.get(row.id) ?? 0,
    thumbs: thumbs.get(row.id) ?? [],
    updatedAt: row.updatedAt.getTime(),
  }));
}

function getRow(db: Db, id: string): Row | undefined {
  return db.select().from(collections).where(eq(collections.id, id)).get();
}

function mustSummarise(db: Db, id: string): CollectionSummary {
  const row = getRow(db, id);

  if (!row) {
    throw new Error(`No collection ${id}`);
  }

  return summarise(db, [row])[0];
}

function touch(db: Db, id: string, now = new Date()): void {
  db.update(collections).set({ updatedAt: now }).where(eq(collections.id, id)).run();
}

/** Closes the gap a removed row at `position` left behind. */
function closeGap(db: Db, id: string, position: number): void {
  db.update(collectionClips)
    .set({ position: sql`${collectionClips.position} - 1` })
    .where(and(eq(collectionClips.collectionId, id), gt(collectionClips.position, position)))
    .run();
}

/** The raw row, for the server actions' ownership checks. */
export function getCollectionRow(db: Db, id: string): Row | undefined {
  return getRow(db, id);
}

export function createCollection(
  db: Db,
  ownerId: string,
  input: { name: string; description?: string | null; open: boolean },
  now: Date = new Date(),
): CollectionSummary {
  const valid = validateCollection({ name: input.name, description: input.description ?? null });
  const id = ulid();

  db.insert(collections)
    .values({
      id,
      ownerId,
      name: valid.name!,
      description: valid.description ?? null,
      open: input.open,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return mustSummarise(db, id);
}

export function updateCollection(
  db: Db,
  id: string,
  patch: { name?: string; description?: string | null; open?: boolean },
): CollectionSummary {
  const valid = validateCollection({ name: patch.name, description: patch.description });

  db.update(collections)
    .set({
      ...(valid.name !== undefined && { name: valid.name }),
      ...(valid.description !== undefined && { description: valid.description }),
      ...(patch.open !== undefined && { open: patch.open }),
      updatedAt: new Date(),
    })
    .where(eq(collections.id, id))
    .run();

  return mustSummarise(db, id);
}

export function deleteCollection(db: Db, id: string): void {
  db.transaction(() => {
    db.delete(collectionClips).where(eq(collectionClips.collectionId, id)).run();
    db.delete(collections).where(eq(collections.id, id)).run();
  });
}

/** Appends at the end. A clip already there stays where it is. */
export function addClip(
  db: Db,
  id: string,
  clipId: string,
  userId: string,
  now: Date = new Date(),
): "added" | "already" {
  return db.transaction(() => {
    const position =
      db
        .select({ n: count() })
        .from(collectionClips)
        .where(eq(collectionClips.collectionId, id))
        .get()?.n ?? 0;
    const inserted = db
      .insert(collectionClips)
      .values({ collectionId: id, clipId, position, addedBy: userId, addedAt: now })
      .onConflictDoNothing()
      .returning({ clipId: collectionClips.clipId })
      .all();

    if (inserted.length === 0) {
      return "already";
    }

    touch(db, id, now);
    return "added";
  });
}

export function removeClip(db: Db, id: string, clipId: string): boolean {
  return db.transaction(() => {
    const removed = db
      .delete(collectionClips)
      .where(and(eq(collectionClips.collectionId, id), eq(collectionClips.clipId, clipId)))
      .returning({ position: collectionClips.position })
      .get();

    if (!removed) {
      return false;
    }

    closeGap(db, id, removed.position);
    touch(db, id);
    return true;
  });
}

/** Puts the clip at `toIndex` (clamped). False when it isn't there or doesn't move. */
export function moveClip(db: Db, id: string, clipId: string, toIndex: number): boolean {
  return db.transaction(() => {
    const ordered = db
      .select({ clipId: collectionClips.clipId })
      .from(collectionClips)
      .where(eq(collectionClips.collectionId, id))
      .orderBy(asc(collectionClips.position))
      .all()
      .map((r) => r.clipId);
    const from = ordered.indexOf(clipId);
    const to = Math.max(0, Math.min(ordered.length - 1, Math.trunc(toIndex)));

    if (from === -1 || from === to) {
      return false;
    }

    ordered.splice(from, 1);
    ordered.splice(to, 0, clipId);
    ordered.forEach((x, position) => {
      db.update(collectionClips)
        .set({ position })
        .where(and(eq(collectionClips.collectionId, id), eq(collectionClips.clipId, x)))
        .run();
    });
    touch(db, id);
    return true;
  });
}

/** Newest updated first; one person's when `ownerId` is given. */
export function listCollections(db: Db, { ownerId }: { ownerId?: string }): CollectionSummary[] {
  const query = db.select().from(collections);
  const rows = (ownerId ? query.where(eq(collections.ownerId, ownerId)) : query)
    .orderBy(desc(collections.updatedAt), desc(collections.id))
    .all();

  return summarise(db, rows);
}

/**
 * The collection with every clip in order, including ones still processing:
 * the owner sees everything, and the theater filters to ready ones itself.
 */
export function getCollection(db: Db, id: string, viewerId: string): CollectionDetail | undefined {
  const row = getRow(db, id);

  if (!row) {
    return undefined;
  }

  const members = db
    .select({ clip: clips, position: collectionClips.position, addedBy: users.authentikUsername })
    .from(collectionClips)
    .innerJoin(clips, eq(collectionClips.clipId, clips.id))
    .leftJoin(users, eq(collectionClips.addedBy, users.id))
    .where(eq(collectionClips.collectionId, id))
    .orderBy(asc(collectionClips.position))
    .all();
  const ids = members.map((m) => m.clip.id);
  const likeCounts = new Map(
    ids.length === 0
      ? []
      : db
          .select({ id: likes.clipId, n: count() })
          .from(likes)
          .where(inArray(likes.clipId, ids))
          .groupBy(likes.clipId)
          .all()
          .map((r) => [r.id, r.n] as const),
  );
  const mine = new Set(
    ids.length === 0
      ? []
      : db
          .select({ id: likes.clipId })
          .from(likes)
          .where(and(eq(likes.userId, viewerId), inArray(likes.clipId, ids)))
          .all()
          .map((r) => r.id),
  );
  const hydrated = hydrateGridClips(
    db,
    members.map((m) => m.clip),
  );

  return {
    ...summarise(db, [row])[0],
    clips: hydrated.map((clip, i) => ({
      ...toSummary(clip),
      likeCount: likeCounts.get(clip.id) ?? 0,
      likedByMe: mine.has(clip.id),
      addedBy: members[i].addedBy ?? "unknown",
      position: members[i].position,
    })),
  };
}

export function getMembership(db: Db, id: string, clipId: string): { addedBy: string } | undefined {
  return db
    .select({ addedBy: collectionClips.addedBy })
    .from(collectionClips)
    .where(and(eq(collectionClips.collectionId, id), eq(collectionClips.clipId, clipId)))
    .get();
}

/**
 * The collections this person can put the clip in — their own and every open
 * one — each flagged with whether it already holds it. Newest updated first.
 */
export function collectionsForClip(db: Db, clipId: string, userId: string): CollectionChoice[] {
  const owner = alias(users, "owner");
  const adder = alias(users, "adder");

  return db
    .select({
      id: collections.id,
      name: collections.name,
      owner: owner.authentikUsername,
      open: collections.open,
      addedBy: adder.authentikUsername,
      member: collectionClips.clipId,
    })
    .from(collections)
    .innerJoin(owner, eq(owner.id, collections.ownerId))
    .leftJoin(
      collectionClips,
      and(eq(collectionClips.collectionId, collections.id), eq(collectionClips.clipId, clipId)),
    )
    .leftJoin(adder, eq(adder.id, collectionClips.addedBy))
    .where(or(eq(collections.ownerId, userId), eq(collections.open, true)))
    .orderBy(desc(collections.updatedAt), desc(collections.id))
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      owner: r.owner,
      open: r.open,
      contains: r.member !== null,
      addedBy: r.addedBy,
    }));
}
