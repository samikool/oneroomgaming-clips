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
    } catch {
      // Skip malformed files; a broken entry must not break the whole load.
    }
  }

  entries.sort((a, b) => b.date.getTime() - a.date.getTime());

  return entries;
}
