import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const IMAGE_ID = /^[a-z0-9]+$/i;

export function coverUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
}

/** Temp file then rename: a half-written cover is never served. */
export async function downloadCoverTo(fetchFn: typeof fetch, imageId: string, dest: string): Promise<void> {
  if (!IMAGE_ID.test(imageId)) {
    throw new Error(`Bad IGDB image id: ${imageId}`);
  }
  const response = await fetchFn(coverUrl(imageId), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`Cover download failed: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  const temp = `${dest}.part`;
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, dest);
  } finally {
    rmSync(temp, { force: true });
  }
}
