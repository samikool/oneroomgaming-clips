import { describe, expect, it } from "bun:test";
import { parseStoredVolume } from "@/lib/theater/volume";

describe("parseStoredVolume", () => {
  it("reads a saved level and mute", () => {
    expect(parseStoredVolume('{"level":0.4,"muted":true}')).toEqual({ level: 0.4, muted: true });
  });

  it("defaults to full volume, unmuted, when nothing is saved", () => {
    expect(parseStoredVolume(null)).toEqual({ level: 1, muted: false });
  });

  it("falls back on anything it cannot trust", () => {
    expect(parseStoredVolume("not json")).toEqual({ level: 1, muted: false });
    expect(parseStoredVolume('{"level":"loud"}')).toEqual({ level: 1, muted: false });
  });

  it("clamps the level into 0..1", () => {
    expect(parseStoredVolume('{"level":7,"muted":false}').level).toBe(1);
    expect(parseStoredVolume('{"level":-2,"muted":false}').level).toBe(0);
  });
});
