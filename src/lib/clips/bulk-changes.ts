/**
 * What a bulk edit asks for, narrowed from whatever the browser sent. Never
 * throws: a bad field means "change nothing there", not a failed save.
 */
export type GameChange =
  | { op: "leave" }
  | { op: "clear" }
  | { op: "local"; id: string }
  | { op: "igdb"; igdbId: number }
  | { op: "text"; name: string };

export type BulkChanges = {
  game: GameChange;
  addTags: string[];
  removeTags: string[];
  addPeople: string[];
  removePeople: string[];
};

export const MAX_IDS = 500;
const CAP = 20;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const CONTROL = /[\x00-\x1f\x7f]/;

export function parseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.filter((id): id is string => typeof id === "string"))];
  return ids.length > MAX_IDS ? null : ids;
}

function names(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const clean = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0 && v.length <= 64 && !CONTROL.test(v));
  return [...new Set(clean)].slice(0, CAP);
}

function game(raw: unknown): GameChange {
  const g = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (g.op === "clear") return { op: "clear" };
  if (g.op === "local" && typeof g.id === "string" && ULID.test(g.id)) return { op: "local", id: g.id };
  if (g.op === "igdb" && Number.isInteger(g.igdbId) && (g.igdbId as number) > 0) return { op: "igdb", igdbId: g.igdbId as number };
  if (g.op === "text" && typeof g.name === "string") {
    const name = g.name.trim();
    if (name.length > 0 && name.length <= 64 && !CONTROL.test(name)) return { op: "text", name };
  }
  return { op: "leave" };
}

export function parseBulkChanges(raw: unknown): BulkChanges {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const removeTags = names(r.removeTags);
  const removePeople = names(r.removePeople);
  // The ✕ is the explicit act: a removal beats the same name typed into add.
  return {
    game: game(r.game),
    addTags: names(r.addTags).filter((t) => !removeTags.includes(t)),
    removeTags,
    addPeople: names(r.addPeople).filter((p) => !removePeople.includes(p)),
    removePeople,
  };
}
