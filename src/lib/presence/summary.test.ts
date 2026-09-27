import { describe, expect, it } from "bun:test";
import { summarizePresence } from "./summary";

describe("summarizePresence", () => {
  it("counts other people, never you", () => {
    expect(summarizePresence(["sam"], [], "sam")).toEqual({ count: 0, others: [] });
  });

  it("lists everyone else, theater first, then by name, flagging who is watching", () => {
    expect(summarizePresence(["sam", "puddy", "kobe", "alex"], ["kobe", "sam"], "sam")).toEqual({
      count: 3,
      others: [
        { username: "kobe", inTheater: true },
        { username: "alex", inTheater: false },
        { username: "puddy", inTheater: false },
      ],
    });
  });

  it("ignores duplicates in the online list", () => {
    expect(summarizePresence(["kobe", "kobe", "sam"], [], "sam").count).toBe(1);
  });
});
