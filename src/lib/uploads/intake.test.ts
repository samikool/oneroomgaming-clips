import { describe, expect, it } from "bun:test";
import { fromInput, walkEntries, type EntryLike } from "./intake";

const fileEntry = (fullPath: string): EntryLike => ({
  isFile: true,
  isDirectory: false,
  fullPath,
  file: (ok) => ok(new File(["x"], fullPath.split("/").pop()!)),
});

// readEntries returns batches and then an empty array, like the real API.
const dirEntry = (fullPath: string, children: EntryLike[], batch = 2): EntryLike => ({
  isFile: false,
  isDirectory: true,
  fullPath,
  createReader: () => {
    let at = 0;
    return {
      readEntries: (ok) => {
        const next = children.slice(at, at + batch);
        at += batch;
        ok(next);
      },
    };
  },
});

describe("walkEntries", () => {
  it("walks folders recursively, across readEntries batches, keeping relative paths", async () => {
    const tree = dirEntry("/Clips", [
      fileEntry("/Clips/a.mp4"),
      dirEntry("/Clips/War Thunder", [fileEntry("/Clips/War Thunder/b.mp4"), fileEntry("/Clips/War Thunder/c.mp4"), fileEntry("/Clips/War Thunder/d.mp4")]),
      fileEntry("/Clips/notes.docx"),
    ]);
    const picked = await walkEntries([tree, fileEntry("/loose.mp4")]);
    expect(picked.map((p) => p.path)).toEqual([
      "Clips/a.mp4", "Clips/War Thunder/b.mp4", "Clips/War Thunder/c.mp4", "Clips/War Thunder/d.mp4", "Clips/notes.docx", "loose.mp4",
    ]);
  });
});

describe("fromInput", () => {
  it("uses webkitRelativePath when the picker chose a folder", () => {
    const f = new File(["x"], "b.mp4");
    Object.defineProperty(f, "webkitRelativePath", { value: "Clips/War Thunder/b.mp4" });
    expect(fromInput([f, new File(["x"], "a.mp4")]).map((p) => p.path)).toEqual(["Clips/War Thunder/b.mp4", "a.mp4"]);
  });
});
