import { gameCover } from "@/lib/games/picker";
import type { PickerResults } from "@/lib/games/search";

/**
 * Best guesses from a file's path, for the upload review list. Pure: no I/O,
 * so every rule is tested against real filenames. Times are read in the
 * runtime's timezone — in the browser, the uploader's.
 */

/** `cover` is display-only art for the picker; the server never sees it. */
export type GameChoice =
  | { kind: "local"; id: string; name: string; cover?: string | null }
  | { kind: "igdb"; igdbId: number; name: string; cover?: string | null }
  | { kind: "text"; name: string };

export function folderOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

const stem = (filename: string) => filename.replace(/\.[^.]+$/, "");

type Stamp = { re: RegExp; read: (m: RegExpMatchArray) => number[] };

// Most specific first. Each gives [year, month, day, hour, minute, second].
const STAMPS: Stamp[] = [
  // ShadowPlay: 2022.02.17 - 21.14.02.03
  { re: /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})/, read: (m) => m.slice(1, 7).map(Number) },
  // OBS / Medal: 2022-03-05 20-01-33 or 2022-03-05_20-01-33
  { re: /(\d{4})-(\d{2})-(\d{2})[ _](\d{2})[-.](\d{2})[-.](\d{2})/, read: (m) => m.slice(1, 7).map(Number) },
  // Compact: 20230704_183012
  { re: /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, read: (m) => m.slice(1, 7).map(Number) },
  // Date only: 2021-11-02 or 2021.11.02
  { re: /(\d{4})[-.](\d{2})[-.](\d{2})/, read: (m) => [...m.slice(1, 4).map(Number), 0, 0, 0] },
];

export function dateFromFilename(filename: string): number | null {
  for (const { re, read } of STAMPS) {
    const match = stem(filename).match(re);
    if (!match) continue;
    const [y, mo, d, h, mi, s] = read(match);
    const date = new Date(y, mo - 1, d, h, mi, s);
    // new Date rolls 2022-13-45 into 2023; a round trip catches it.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59 || s > 59) {
      return null;
    }
    return date.getTime();
  }
  return null;
}

export function cleanTitle(filename: string, recordedAt: number | null): string {
  const original = stem(filename);
  let title = original.replace(/_/g, " ");
  // Only the ShadowPlay stamp and its DVR tag are removed: they are pure
  // noise. OBS names ("Replay 2025-03-01 …") are left alone — the date is
  // the only thing that tells those clips apart.
  title = title.replace(/\s*\d{4}\.\d{2}\.\d{2} - \d{2}\.\d{2}\.\d{2}(\.\d+)?/, "");
  title = title.replace(/\.?\bDVR\b/gi, "");
  // A trailing "(2)" or a "-1" straight after a word; "21-14-02" keeps its seconds.
  title = title.replace(/\s*\(\d+\)$/, "").replace(/(?<=[A-Za-z])-\d{1,2}$/, "");
  title = title.replace(/\s+/g, " ").trim();
  if (title.length > 0 && !/^[\d\s.:-]+$/.test(title)) {
    return title.slice(0, 200);
  }
  if (recordedAt !== null) {
    return new Date(recordedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  return original.slice(0, 200);
}

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

export function peopleFromPath(path: string, people: { username: string; name: string }[]): string[] {
  const inPath = words(path.replace(/\.[^.\/]+$/, ""));
  const found = people.filter((p) => {
    const nameWords = [...words(p.name)];
    return inPath.has(p.username.toLowerCase()) || (nameWords.length === 1 && inPath.has(nameWords[0]));
  });
  return found.map((p) => p.username).sort();
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function pickGame(folder: string, results: PickerResults): GameChoice | null {
  const want = norm(folder);
  if (!want) return null;
  const exact = results.local.find((g) => norm(g.name) === want);
  if (exact) return { kind: "local", id: exact.id, name: exact.name, cover: gameCover(exact) };
  const contained = results.local
    .filter((g) => norm(g.name).length > 0 && want.includes(norm(g.name)))
    .sort((a, b) => norm(b.name).length - norm(a.name).length)[0];
  if (contained) return { kind: "local", id: contained.id, name: contained.name, cover: gameCover(contained) };
  const top = results.igdb[0];
  return top ? { kind: "igdb", igdbId: top.igdbId, name: top.name, cover: gameCover(top) } : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
}
