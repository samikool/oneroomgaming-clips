import type { IgdbGame } from "@/lib/igdb/api";
import { coverPublicPath } from "@/lib/media/paths";
import type { LocalGame } from "./search";

export type SearchState = "idle" | "searching" | "done" | "failed";
/** A real game is in the box: its art, or null for one with no cover. */
export type Picked = { cover: string | null };

/** Text to keep as a typed game, or null while the box still shows a pick. */
export function typedText(text: string, picked: Picked | null): string | null {
  return picked ? null : text.trim();
}

/** A picker row's art: your game's saved cover, or IGDB's thumbnail. */
export function gameCover(game: LocalGame | IgdbGame): string | null {
  if ("coverPath" in game) return game.coverPath ? coverPublicPath(game.coverPath) : null;
  return game.coverImageId ? `https://images.igdb.com/igdb/image/upload/t_thumb/${game.coverImageId}.jpg` : null;
}

/** The line under the results, so an empty list never looks like a dead box. */
export function pickerNotice(state: { search: SearchState; query: string; count: number; igdbOnly: boolean }): string | null {
  const { search, query, count, igdbOnly } = state;
  if (search === "searching") return "Searching…";
  if (search === "failed") return "Search failed. Keep typing to try again.";
  if (search === "done" && count === 0) {
    return igdbOnly ? `Nothing on IGDB for “${query}”.` : `No match. Enter keeps “${query}” as a new game.`;
  }
  return null;
}
