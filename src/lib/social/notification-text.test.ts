import { describe, expect, it } from "bun:test";
import type { NotificationSummary } from "@/lib/realtime/envelope";
import { notificationHref, notificationText } from "./notification-text";

const names: Record<string, string> = { kobe: "Kobe", sam: "Sam", pat: "Pat", lee: "Lee" };
const nameOf = (u: string) => names[u] ?? u;

function n(over: Partial<NotificationSummary>): NotificationSummary {
  return {
    id: "N",
    type: "like",
    clipId: "C1",
    clipTitle: "did_i_get_him",
    actors: ["kobe"],
    commentId: null,
    excerpt: null,
    positionMs: null,
    source: null,
    updatedAt: 1,
    read: false,
    ...over,
  };
}

function plain(over: Partial<NotificationSummary>): string {
  const { lead, title, tail } = notificationText(n(over), nameOf);
  return `${lead}*${title}*${tail}`;
}

describe("notificationText", () => {
  it("names 1, 2, 3 and 4+ actors", () => {
    expect(plain({ actors: ["kobe"] })).toBe("Kobe liked *did_i_get_him*");
    expect(plain({ actors: ["kobe", "sam"] })).toBe("Kobe and Sam liked *did_i_get_him*");
    expect(plain({ actors: ["kobe", "sam", "pat"] })).toBe("Kobe, Sam and Pat liked *did_i_get_him*");
    expect(plain({ actors: ["kobe", "sam", "pat", "lee"] })).toBe("Kobe, Sam and 2 others liked *did_i_get_him*");
  });

  it("words every type", () => {
    expect(plain({ type: "comment", excerpt: "nice shot" })).toBe("Kobe commented on *did_i_get_him*: “nice shot”");
    expect(plain({ type: "comment" })).toBe("Kobe commented on *did_i_get_him*");
    expect(plain({ type: "participant_comment", excerpt: "gg" })).toBe("Kobe commented on *did_i_get_him*, a clip you're in: “gg”");
    expect(plain({ type: "tagged" })).toBe("Kobe tagged you in *did_i_get_him*");
    expect(plain({ type: "mention", source: "comment", excerpt: "@sam look" })).toBe(
      "Kobe mentioned you on *did_i_get_him*: “@sam look”",
    );
  });

  it("words a chat mention as theater chat", () => {
    expect(plain({ type: "mention", source: "chat" })).toBe("Kobe mentioned you in theater chat during *did_i_get_him*");
  });
});

describe("notificationHref", () => {
  it("links to the clip, at the comment's time when there is one", () => {
    expect(notificationHref(n({}))).toBe("/clips/C1");
    expect(notificationHref(n({ positionMs: 12_500 }))).toBe("/clips/C1?t=12");
  });
});
