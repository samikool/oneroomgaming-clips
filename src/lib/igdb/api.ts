import type { TokenSource } from "./token";

export type IgdbGame = { igdbId: number; name: string; year: number | null; coverImageId: string | null };

type Raw = { id: number; name: string; first_release_date?: number; cover?: { image_id?: string } };

const FIELDS = "fields name,first_release_date,cover.image_id;";

function toGame(raw: Raw): IgdbGame {
  return {
    igdbId: raw.id,
    name: raw.name,
    year: raw.first_release_date ? new Date(raw.first_release_date * 1000).getUTCFullYear() : null,
    coverImageId: raw.cover?.image_id ?? null,
  };
}

/** IGDB's query language quotes search text; a stray quote or backslash would break it. */
export function cleanSearch(q: string): string {
  return q.replace(/["\\]/g, "").trim();
}

export function createApi(clientId: string, tokens: TokenSource, fetchFn: typeof fetch) {
  async function query(body: string): Promise<Raw[]> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchFn("https://api.igdb.com/v4/games", {
        method: "POST",
        headers: { "Client-ID": clientId, Authorization: `Bearer ${await tokens.get()}` },
        body,
        signal: AbortSignal.timeout(3000),
      });
      if (response.status === 401 && attempt === 0) {
        tokens.invalidate();
        continue;
      }
      if (!response.ok) {
        throw new Error(`IGDB query failed: ${response.status}`);
      }
      return (await response.json()) as Raw[];
    }
    throw new Error("IGDB rejected a fresh token");
  }

  return {
    async search(q: string): Promise<IgdbGame[]> {
      const text = cleanSearch(q);
      // Editions carry a version_parent; the base game does not. game_type keeps
      // main games, standalone expansions, remakes, remasters and expanded
      // games — not DLC, bundles, mods, episodes or ports, which would each
      // become a separate game here.
      const rows = await query(
        `search "${text}"; ${FIELDS} where version_parent = null & game_type = (0,4,8,9,10); limit 8;`,
      );
      return rows.map(toGame);
    },
    async getGame(id: number): Promise<IgdbGame | null> {
      const rows = await query(`${FIELDS} where id = ${Math.trunc(id)};`);
      return rows[0] ? toGame(rows[0]) : null;
    },
  };
}
