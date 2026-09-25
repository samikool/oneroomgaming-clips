import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const DEFAULT_CHANGELOG_DIR = join(process.cwd(), "content", "changelog");

export interface ChangelogEntry {
  version: string;
  date: Date;
  title: string;
  /** Raw markdown body. */
  body: string;
  /** Rendered HTML body. */
  html: string;
}

export function formatEntryDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function parseEntry(filePath: string): ChangelogEntry | null {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  const { version, date, title } = parsed.data;

  if (typeof version !== "string" || !version.trim()) {
    return null;
  }

  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  if (typeof title !== "string" || !title.trim()) {
    return null;
  }

  const body = parsed.content.trim();

  return {
    version,
    date: parsedDate,
    title,
    body,
    html: marked.parse(body, { async: false }) as string,
  };
}

/**
 * Reads and parses every changelog entry from `dir` (default:
 * `content/changelog` at the repo root), returning them newest-first.
 *
 * A malformed or frontmatter-less file is skipped rather than crashing the
 * whole load.
 */
/**
 * Compares two dotted version strings numerically, newest first when used as a
 * descending comparator.
 *
 * String comparison is wrong here — "0.0.10" sorts below "0.0.9" — and a
 * missing component counts as zero so "1.0" and "1.0.0" are equal. A
 * non-numeric component becomes 0 rather than NaN, so a malformed version
 * sorts last instead of poisoning the comparison.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

/**
 * Newest first: date, then version.
 *
 * Exported so it can be tested directly. Going through `getChangelogEntries`
 * cannot test the tie-break, because `readdirSync` returns hash order on ext4
 * rather than sorted order — a fixture-based test passes or fails on the
 * accident of how the filenames hash.
 *
 * Several releases can share a day. Before the tie-break, `latest` among them
 * was whatever readdir happened to yield, so the release modal could announce
 * the wrong version to everyone.
 */
export function compareEntries(
  a: Pick<ChangelogEntry, "date" | "version">,
  b: Pick<ChangelogEntry, "date" | "version">,
): number {
  const byDate = b.date.getTime() - a.date.getTime();
  return byDate !== 0 ? byDate : compareVersions(b.version, a.version);
}

export function getChangelogEntries(
  dir: string = DEFAULT_CHANGELOG_DIR,
): ChangelogEntry[] {
  let filenames: string[];
  try {
    filenames = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }

  const entries: ChangelogEntry[] = [];

  for (const filename of filenames) {
    try {
      const entry = parseEntry(join(dir, filename));
      if (entry) {
        entries.push(entry);
      }
    } catch (error) {
      console.error(`changelog: failed to read ${filename}`, error);
    }
  }

  entries.sort(compareEntries);

  return entries;
}
