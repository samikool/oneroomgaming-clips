/**
 * @mentions, stored as plain `@username` text so they survive renames.
 *
 * An @ counts at the start or after a non-word character, so `sam@kobe.com`
 * is an email and not a mention of kobe.
 */
const MENTION = /(^|[^\w@])@([\w.-]+)/g;

/** "@kobe!" or "@a.b," — trailing dots and dashes are punctuation, not name. */
function strip(name: string): string {
  return name.replace(/[.-]+$/, "");
}

function resolve(raw: string, known: Set<string>): string | null {
  const lower = strip(raw).toLowerCase();
  for (const name of known) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

/** Known usernames mentioned in `text`, once each, in order, never `self`. */
export function extractMentions(text: string, known: Set<string>, self: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const name = resolve(match[2], known);
    if (name && name !== self && !found.includes(name)) found.push(name);
  }
  return found;
}

export type MentionPart = { text: string } | { username: string };

/** Text split around known mentions, for rendering. Unknown @things stay text. */
export function splitMentions(text: string, known: Set<string>): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const name = resolve(match[2], known);
    if (!name) continue;
    const start = match.index + match[1].length;
    const end = start + 1 + strip(match[2]).length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ username: name });
    last = end;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length === 0 ? [{ text }] : parts;
}

/** The picker's matches: a username prefix, or the start of any word in the name. */
export function matchMentionCandidates<T extends { username: string; name: string }>(prefix: string, people: T[]): T[] {
  const p = prefix.toLowerCase();
  return people.filter(
    (person) =>
      person.username.toLowerCase().startsWith(p) ||
      person.name
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(p)),
  );
}
