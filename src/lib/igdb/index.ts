import { createApi, type IgdbGame } from "./api";
import { downloadCoverTo } from "./cover";
import { createTokenSource } from "./token";

export type { IgdbGame } from "./api";
export { coverUrl } from "./cover";

export type Igdb = {
  search(q: string): Promise<IgdbGame[]>;
  getGame(id: number): Promise<IgdbGame | null>;
  downloadCover(imageId: string, dest: string): Promise<void>;
};

/** Null when either key is missing: IGDB is simply off and the site works as before. */
export function createIgdb(
  env: Partial<NodeJS.ProcessEnv>,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Igdb | null {
  const id = env.IGDB_CLIENT_ID;
  const secret = env.IGDB_CLIENT_SECRET;
  if (!id || !secret) {
    return null;
  }
  const api = createApi(id, createTokenSource(id, secret, fetchFn, now), fetchFn);
  return { ...api, downloadCover: (imageId, dest) => downloadCoverTo(fetchFn, imageId, dest) };
}

let shared: Igdb | null | undefined;

/** One instance per process, so one token is shared by every request. */
export function getIgdb(): Igdb | null {
  if (shared === undefined) {
    shared = createIgdb(process.env);
  }
  return shared;
}
