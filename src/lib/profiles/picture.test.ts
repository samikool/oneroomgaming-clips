import { describe, expect, it } from "bun:test";
import { avatarsDir, pictureFilename, picturePath } from "./picture";

describe("picture paths", () => {
  it("is null without a picture", () => {
    expect(picturePath({ userId: "U1", pictureVersion: null }, 64)).toBeNull();
  });

  it("includes the version so a new upload busts every cache", () => {
    expect(picturePath({ userId: "U1", pictureVersion: 2 }, 256)).toBe("/media/avatars/U1-2-256.webp");
    expect(pictureFilename("U1", 3, 64)).toBe("U1-3-64.webp");
  });

  it("lives under MEDIA_ROOT", () => {
    expect(avatarsDir({ MEDIA_ROOT: "/m" })).toBe("/m/avatars");
  });
});
