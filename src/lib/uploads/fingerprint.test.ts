import { describe, expect, it } from "bun:test";
import { fingerprint, SAMPLE_BYTES } from "./fingerprint";

const blob = (...parts: (string | Uint8Array)[]) => new Blob(parts as BlobPart[]);
const filled = (length: number, value: number) => new Uint8Array(length).fill(value);

describe("fingerprint", () => {
  it("is 64 lowercase hex characters", async () => {
    expect(await fingerprint(blob("hello"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for the same bytes", async () => {
    expect(await fingerprint(blob("same clip"))).toBe(await fingerprint(blob("same clip")));
  });

  it("differs when the ending differs", async () => {
    const head = filled(SAMPLE_BYTES * 3, 1);
    expect(await fingerprint(blob(head, "a"))).not.toBe(await fingerprint(blob(head, "b")));
  });

  it("differs when only the size differs", async () => {
    // Same first and last MiB, one extra byte in the middle.
    const edge = filled(SAMPLE_BYTES, 7);
    const a = blob(edge, filled(10, 0), edge);
    const b = blob(edge, filled(11, 0), edge);
    expect(await fingerprint(a)).not.toBe(await fingerprint(b));
  });

  it("handles a file smaller than the two samples", async () => {
    expect(await fingerprint(blob("tiny"))).not.toBe(await fingerprint(blob("tinY")));
  });
});
