import type { NotificationType } from "@/db/schema";

/** Something someone did that may notify other people. Usernames throughout. */
export type SocialEvent =
  | { kind: "like"; actor: string; uploader: string | null }
  | { kind: "comment"; actor: string; uploader: string | null; participants: string[]; mentioned: string[] }
  | { kind: "tagged"; actor: string; added: string[] }
  | { kind: "chat"; actor: string; mentioned: string[] };

/** One notification per person per event, never for your own action; a mention outranks the rest. */
export function recipientsFor(event: SocialEvent): { username: string; type: NotificationType }[] {
  const out = new Map<string, NotificationType>();
  const give = (username: string | null, type: NotificationType) => {
    if (username && username !== event.actor && !out.has(username)) out.set(username, type);
  };

  switch (event.kind) {
    case "like":
      give(event.uploader, "like");
      break;
    case "comment":
      event.mentioned.forEach((u) => give(u, "mention"));
      give(event.uploader, "comment");
      event.participants.forEach((u) => give(u, "participant_comment"));
      break;
    case "tagged":
      event.added.forEach((u) => give(u, "tagged"));
      break;
    case "chat":
      event.mentioned.forEach((u) => give(u, "mention"));
      break;
  }

  return [...out].map(([username, type]) => ({ username, type }));
}
