import { asc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { clipParticipants, clips, clipTags, games, tags, users } from "./schema";

export type ClipMetadata = {
  tags: string[];
  game: { id: string; name: string; slug: string } | null;
  participants: string[];
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Tags are case-insensitive: "Ace", "ace" and "ACE" are one tag. */
function normalizeTag(name: string): string {
  return name.trim().toLowerCase();
}

export function listTags(db: Db): string[] {
  return db
    .select({ name: tags.name })
    .from(tags)
    .orderBy(asc(tags.name))
    .all()
    .map((row) => row.name);
}

export function listGames(db: Db): { id: string; name: string; slug: string }[] {
  return db.select().from(games).orderBy(asc(games.name)).all();
}

export function getClipMetadata(db: Db, clipId: string): ClipMetadata {
  const tagRows = db
    .select({ name: tags.name })
    .from(clipTags)
    .innerJoin(tags, eq(clipTags.tagId, tags.id))
    .where(eq(clipTags.clipId, clipId))
    .orderBy(asc(tags.name))
    .all();

  const participantRows = db
    .select({ name: users.authentikUsername })
    .from(clipParticipants)
    .innerJoin(users, eq(clipParticipants.userId, users.id))
    .where(eq(clipParticipants.clipId, clipId))
    .orderBy(asc(users.authentikUsername))
    .all();

  const game =
    db
      .select({ id: games.id, name: games.name, slug: games.slug })
      .from(clips)
      .innerJoin(games, eq(clips.gameId, games.id))
      .where(eq(clips.id, clipId))
      .get() ?? null;

  return {
    tags: tagRows.map((row) => row.name),
    game,
    participants: participantRows.map((row) => row.name),
  };
}

/** Replaces the clip's whole tag set. Returns what it settled on. */
export function setClipTags(db: Db, clipId: string, names: string[]): string[] {
  const wanted = [...new Set(names.map(normalizeTag).filter((name) => name.length > 0))].sort();

  db.delete(clipTags).where(eq(clipTags.clipId, clipId)).run();

  for (const name of wanted) {
    // Reuse the tag row if it exists: `tags.name` is unique, and inserting a
    // duplicate would throw rather than dedupe.
    const existing = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
    const id = existing?.id ?? ulid();

    if (!existing) {
      db.insert(tags).values({ id, name }).run();
    }

    db.insert(clipTags).values({ clipId, tagId: id }).run();
  }

  return wanted;
}

/** Sets or clears the clip's game. Returns the game's name, or null. */
export function setClipGame(db: Db, clipId: string, name: string | null): string | null {
  const trimmed = name?.trim() ?? "";

  if (trimmed.length === 0) {
    db.update(clips).set({ gameId: null }).where(eq(clips.id, clipId)).run();
    return null;
  }

  const slug = slugify(trimmed);
  const existing = db.select().from(games).where(eq(games.slug, slug)).get();
  const id = existing?.id ?? ulid();

  if (!existing) {
    db.insert(games).values({ id, name: trimmed, slug }).run();
  }

  db.update(clips).set({ gameId: id }).where(eq(clips.id, clipId)).run();

  // The first spelling wins, so "Valorant" does not become "valorant" because
  // someone typed it in lowercase later.
  return existing?.name ?? trimmed;
}

/** Replaces the clip's whole participant set. Returns the usernames it kept. */
export function setClipParticipants(db: Db, clipId: string, usernames: string[]): string[] {
  const wanted = [...new Set(usernames.map((name) => name.trim()).filter(Boolean))];

  db.delete(clipParticipants).where(eq(clipParticipants.clipId, clipId)).run();

  if (wanted.length === 0) {
    return [];
  }

  // Users only exist after their first login. A mistyped name must not create
  // a ghost row that then haunts the participant filter forever.
  const known = db
    .select({ id: users.id, name: users.authentikUsername })
    .from(users)
    .where(inArray(users.authentikUsername, wanted))
    .all();

  for (const user of known) {
    db.insert(clipParticipants).values({ clipId, userId: user.id }).run();
  }

  return known.map((user) => user.name).sort();
}
