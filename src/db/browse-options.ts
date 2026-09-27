import { asc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { clips, clipTags, games, tags } from "./schema";

export type BrowseOptions = { games: { slug: string; name: string }[]; tags: string[] };

/** What the Game and Tag filters offer: only names some clip actually carries. */
export function listBrowseOptions(db: Db): BrowseOptions {
  return {
    games: db
      .selectDistinct({ slug: games.slug, name: games.name })
      .from(games)
      .innerJoin(clips, eq(clips.gameId, games.id))
      .orderBy(asc(games.name))
      .all(),
    tags: db
      .selectDistinct({ name: tags.name })
      .from(tags)
      .innerJoin(clipTags, eq(clipTags.tagId, tags.id))
      .orderBy(asc(tags.name))
      .all()
      .map((row) => row.name),
  };
}
