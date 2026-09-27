import { describe, expect, it } from "bun:test";
import { extractMentions, matchMentionCandidates, splitMentions } from "./mentions";

const known = new Set(["sam", "kobe", "a.b"]);

describe("extractMentions", () => {
  it("finds known usernames, once each, case-insensitively", () => {
    expect(extractMentions("@Kobe look @sam @kobe", known, "pat")).toEqual(["kobe", "sam"]);
  });

  it("ignores emails, unknown names and yourself", () => {
    expect(extractMentions("mail sam@kobe.com @ghost @sam", known, "sam")).toEqual([]);
  });

  it("handles names with dots and trailing punctuation", () => {
    expect(extractMentions("hey @a.b, and @kobe!", known, "sam")).toEqual(["a.b", "kobe"]);
  });
});

describe("splitMentions", () => {
  it("splits text around known mentions", () => {
    expect(splitMentions("gg @kobe nice", known)).toEqual([{ text: "gg " }, { username: "kobe" }, { text: " nice" }]);
    expect(splitMentions("@ghost hi", known)).toEqual([{ text: "@ghost hi" }]);
  });

  it("keeps trailing punctuation as text", () => {
    expect(splitMentions("yo @kobe.", known)).toEqual([{ text: "yo " }, { username: "kobe" }, { text: "." }]);
  });
});

describe("matchMentionCandidates", () => {
  const people = [
    { username: "kobe", name: "KOBEEEE" },
    { username: "sam", name: "Big Sam" },
  ];

  it("matches a username prefix or any word of the display name", () => {
    expect(matchMentionCandidates("kob", people).map((p) => p.username)).toEqual(["kobe"]);
    expect(matchMentionCandidates("sa", people).map((p) => p.username)).toEqual(["sam"]);
    expect(matchMentionCandidates("big", people).map((p) => p.username)).toEqual(["sam"]);
    expect(matchMentionCandidates("", people)).toHaveLength(2);
  });
});
