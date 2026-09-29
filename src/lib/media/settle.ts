import { closeSync, openSync, readSync } from "node:fs";

function readFirstByte(path: string): void {
  const fd = openSync(path, "r");
  try {
    readSync(fd, Buffer.alloc(1), 0, 1, 0);
  } finally {
    closeSync(fd);
  }
}

export type SettleOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  read?: (path: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Waits until `path` can be read, for a file that was just hard-linked on the
 * SMB share. For about a second after the link is made, opening or reading it
 * fails with EINVAL; ffprobe hit that on every upload and each clip went
 * through a retry.
 *
 * Never throws. On a timeout, or any other error, the caller's own read
 * reports what is wrong.
 */
export async function waitUntilReadable(
  path: string,
  {
    timeoutMs = 10_000,
    intervalMs = 250,
    read = readFirstByte,
    sleep = Bun.sleep,
    now = () => performance.now(),
  }: SettleOptions = {},
): Promise<void> {
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      read(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EINVAL" || now() >= deadline) {
        return;
      }
    }

    await sleep(intervalMs);
  }
}
