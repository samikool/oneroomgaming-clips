/** How much of each end of the file is read. */
export const SAMPLE_BYTES = 1024 * 1024;

/**
 * A quick identity for a video file: SHA-256 of its size, first MiB and last
 * MiB. Reads at most 2 MiB however big the clip is, so it takes milliseconds.
 * Two different recordings with the same length and identical first and last
 * megabyte do not happen in practice; the server stores this with a unique
 * index to refuse the same file twice, whoever uploads it.
 */
export async function fingerprint(file: Blob): Promise<string> {
  const head = file.slice(0, SAMPLE_BYTES);
  const tail = file.slice(Math.max(SAMPLE_BYTES, file.size - SAMPLE_BYTES));
  const size = new TextEncoder().encode(`${file.size}:`);
  const data = new Uint8Array(await new Blob([size, head, tail]).arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
