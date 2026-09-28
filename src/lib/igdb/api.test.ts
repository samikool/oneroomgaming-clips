import { describe, expect, it } from "bun:test";
import { createIgdb } from "./index";

type Call = { url: string; body: string; headers: Record<string, string> };

function fakeIgdb(responses: Response[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("id.twitch.tv")) {
      return Response.json({ access_token: `t${calls.length}`, expires_in: 3600 });
    }
    calls.push({ url: String(url), body: String(init?.body), headers: init?.headers as Record<string, string> });
    return responses.shift()!;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const env = { IGDB_CLIENT_ID: "cid", IGDB_CLIENT_SECRET: "sec" };

describe("createIgdb", () => {
  it("is disabled without both keys", () => {
    expect(createIgdb({})).toBeNull();
    expect(createIgdb({ IGDB_CLIENT_ID: "cid" })).toBeNull();
  });

  it("searches main games and maps the response", async () => {
    const { fn, calls } = fakeIgdb([
      Response.json([
        { id: 115, name: "League of Legends", first_release_date: 1256601600, cover: { image_id: "co49wj" } },
        { id: 7, name: "No Cover", },
      ]),
    ]);
    const igdb = createIgdb(env, fn)!;
    expect(await igdb.search("league")).toEqual([
      { igdbId: 115, name: "League of Legends", year: 2009, coverImageId: "co49wj" },
      { igdbId: 7, name: "No Cover", year: null, coverImageId: null },
    ]);
    expect(calls[0].url).toBe("https://api.igdb.com/v4/games");
    expect(calls[0].headers["Client-ID"]).toBe("cid");
    expect(calls[0].body).toContain('search "league";');
    expect(calls[0].body).toContain("version_parent = null");
    expect(calls[0].body).toContain("game_type = (0,4,8,9,10)");
    expect(calls[0].body).toContain("limit 8;");
  });

  it("strips quotes and backslashes from the search text", async () => {
    const { fn, calls } = fakeIgdb([Response.json([])]);
    await createIgdb(env, fn)!.search('Assassin"s \\Creed');
    expect(calls[0].body).toContain('search "Assassins Creed";');
  });

  it("retries once with a fresh token after a 401", async () => {
    const { fn, calls } = fakeIgdb([new Response("", { status: 401 }), Response.json([])]);
    expect(await createIgdb(env, fn)!.search("x y")).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[0].headers.Authorization).not.toBe(calls[1].headers.Authorization);
  });

  it("gets one game by id, or null", async () => {
    const { fn, calls } = fakeIgdb([
      Response.json([{ id: 115, name: "League of Legends", cover: { image_id: "co49wj" } }]),
      Response.json([]),
    ]);
    const igdb = createIgdb(env, fn)!;
    expect((await igdb.getGame(115))?.name).toBe("League of Legends");
    expect(calls[0].body).toContain("where id = 115;");
    expect(await igdb.getGame(999)).toBeNull();
  });
});
