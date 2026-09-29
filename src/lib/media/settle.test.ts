import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitUntilReadable } from "@/lib/media/settle";

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** A clock that only moves when the code under test sleeps. */
function fakeTime() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

describe("waitUntilReadable", () => {
  it("returns at once for a file that reads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clips-settle-"));
    const path = join(dir, "a.mp4");
    writeFileSync(path, "x");
    const time = fakeTime();

    await waitUntilReadable(path, time);

    expect(time.sleeps).toEqual([]);
  });

  it("waits out EINVAL until the file reads", async () => {
    // What the SMB share does for about a second after the upload's hard link
    // is made: open and read fail with EINVAL, then start working.
    const time = fakeTime();
    let calls = 0;
    const read = () => {
      calls += 1;
      if (calls <= 4) throw errno("EINVAL");
    };

    await waitUntilReadable("/share/clip.mp4", { ...time, read });

    expect(calls).toBe(5);
    expect(time.sleeps).toEqual([250, 250, 250, 250]);
  });

  it("gives up after the timeout and leaves the error to the caller", async () => {
    const time = fakeTime();
    const read = () => {
      throw errno("EINVAL");
    };

    await waitUntilReadable("/share/clip.mp4", { ...time, read, timeoutMs: 1_000 });

    expect(time.now()).toBe(1_000);
  });

  it("does not wait on errors that will not clear up", async () => {
    const time = fakeTime();
    let calls = 0;
    const read = () => {
      calls += 1;
      throw errno("ENOENT");
    };

    await waitUntilReadable("/share/missing.mp4", { ...time, read });

    expect(calls).toBe(1);
    expect(time.sleeps).toEqual([]);
  });
});
