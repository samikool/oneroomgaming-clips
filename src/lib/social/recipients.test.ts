import { describe, expect, it } from "bun:test";
import { recipientsFor } from "./recipients";

describe("recipientsFor", () => {
  it("a like notifies the uploader, never yourself", () => {
    expect(recipientsFor({ kind: "like", actor: "kobe", uploader: "sam" })).toEqual([{ username: "sam", type: "like" }]);
    expect(recipientsFor({ kind: "like", actor: "sam", uploader: "sam" })).toEqual([]);
  });

  it("a like on a clip with no uploader notifies nobody", () => {
    expect(recipientsFor({ kind: "like", actor: "kobe", uploader: null })).toEqual([]);
  });

  it("a comment notifies the uploader and participants, and mention wins over both", () => {
    expect(
      recipientsFor({ kind: "comment", actor: "kobe", uploader: "sam", participants: ["pat", "kobe"], mentioned: ["pat"] }),
    ).toEqual([
      { username: "pat", type: "mention" },
      { username: "sam", type: "comment" },
    ]);
  });

  it("a comment notifies a participant who is not mentioned", () => {
    expect(recipientsFor({ kind: "comment", actor: "kobe", uploader: "sam", participants: ["lee"], mentioned: [] })).toEqual([
      { username: "sam", type: "comment" },
      { username: "lee", type: "participant_comment" },
    ]);
  });

  it("a comment on your own clip mentioning yourself notifies nobody", () => {
    expect(recipientsFor({ kind: "comment", actor: "sam", uploader: "sam", participants: [], mentioned: ["sam"] })).toEqual([]);
  });

  it("tagging notifies the added people except yourself", () => {
    expect(recipientsFor({ kind: "tagged", actor: "sam", added: ["sam", "kobe"] })).toEqual([{ username: "kobe", type: "tagged" }]);
  });

  it("chat notifies mentioned people", () => {
    expect(recipientsFor({ kind: "chat", actor: "sam", mentioned: ["kobe", "sam"] })).toEqual([{ username: "kobe", type: "mention" }]);
  });
});
