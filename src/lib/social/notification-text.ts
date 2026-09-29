import { filterHref } from "@/lib/browse/query";
import type { NotificationSummary } from "@/lib/realtime/envelope";

/** "Kobe", "Kobe and Sam", "Kobe, Sam and Pat", "Kobe, Sam and 2 others". */
function actorList(actors: string[], nameOf: (username: string) => string): string {
  const names = actors.map(nameOf);
  if (names.length <= 1) return names[0] ?? "Someone";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/**
 * A notification's line, in three parts so the clip title can be set apart:
 * `lead` + title + `tail`.
 */
export function notificationText(
  n: NotificationSummary,
  nameOf: (username: string) => string,
): { lead: string; title: string; tail: string } {
  const who = actorList(n.actors, nameOf);
  const quote = n.excerpt ? `: “${n.excerpt}”` : "";
  const title = n.clipTitle;

  switch (n.type) {
    case "like":
      return { lead: `${who} liked `, title, tail: "" };
    case "comment":
      return { lead: `${who} commented on `, title, tail: quote };
    case "participant_comment":
      return { lead: `${who} commented on `, title, tail: `, a clip you're in${quote}` };
    case "tagged":
      return { lead: `${who} tagged you in `, title, tail: "" };
    case "tagged_bulk":
      return { lead: `${who} tagged you in ${n.count ?? "several"} clips`, title: "", tail: "" };
    case "mention":
      return n.source === "chat"
        ? { lead: `${who} mentioned you in theater chat during `, title, tail: "" }
        : { lead: `${who} mentioned you on `, title, tail: quote };
  }
}

/** The clip, at the comment's moment when it has one. */
export function notificationHref(n: NotificationSummary): string {
  // A bulk tag spans many clips: show all of the recipient's.
  if (n.type === "tagged_bulk" && n.recipient) return filterHref("people", n.recipient);
  const base = `/clips/${n.clipId}`;
  return n.positionMs === null ? base : `${base}?t=${Math.floor(n.positionMs / 1000)}`;
}
