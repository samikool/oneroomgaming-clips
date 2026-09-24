import { describe, expect, it } from "bun:test";
import { unionTopics } from "@/lib/realtime/topics";

describe("unionTopics", () => {
  it("returns an empty list when nothing is registered", () => {
    expect(unionTopics([])).toEqual([]);
  });

  it("merges overlapping groups without duplicates", () => {
    expect(unionTopics([["grid"], ["grid", "room"]])).toEqual(["grid", "room"]);
  });

  it("sorts so the same set always produces the same subscribe frame", () => {
    expect(unionTopics([["room", "grid"]])).toEqual(unionTopics([["grid", "room"]]));
  });
});
