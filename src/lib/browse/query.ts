export const SORTS = ["new", "trending", "top", "random"] as const;
export type Sort = (typeof SORTS)[number];

export type BrowseQuery = {
  sort: Sort;
  q: string;
  games: string[];
  tags: string[];
  people: string[];
  /** Random tab only: fixed for a visit so paging continues one shuffle. */
  seed: number;
};

const Q_MAX = 100;
type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function all(params: Params, key: string): string[] {
  const raw = params instanceof URLSearchParams ? params.getAll(key) : ([] as string[]).concat(params[key] ?? []);
  return raw.map((value) => value.trim()).filter((value) => value.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function freshSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function parseBrowseQuery(params: Params): BrowseQuery {
  const [sort] = all(params, "sort");
  const [q = ""] = all(params, "q");
  const [seed] = all(params, "seed");
  const parsedSeed = Number(seed);

  return {
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : "new",
    q: [...q].slice(0, Q_MAX).join(""),
    games: unique(all(params, "game")),
    tags: unique(all(params, "tag").map((tag) => tag.toLowerCase())),
    // Old links and chips said uploader= or participant=; both mean "a clip with this person in it" now.
    people: unique([...all(params, "person"), ...all(params, "uploader"), ...all(params, "participant")]),
    seed: Number.isInteger(parsedSeed) && parsedSeed >= 0 ? parsedSeed : freshSeed(),
  };
}

/** Stable key order, so one query is always one URL. */
export function serializeBrowseQuery(query: BrowseQuery, { includeSeed = false } = {}): string {
  const out = new URLSearchParams();

  if (query.sort !== "new") out.set("sort", query.sort);
  if (query.q) out.set("q", query.q);
  for (const game of query.games) out.append("game", game);
  for (const tag of query.tags) out.append("tag", tag);
  for (const person of query.people) out.append("person", person);
  if (includeSeed) out.set("seed", String(query.seed));

  return out.toString();
}

export function isFiltered(query: BrowseQuery): boolean {
  return query.q.trim().length > 0 || query.games.length > 0 || query.tags.length > 0 || query.people.length > 0;
}

/** A link to home's browser filtered to one game, tag or person, for chips outside the browser. */
export function filterHref(field: "games" | "tags" | "people", value: string): string {
  return `/?${serializeBrowseQuery({ sort: "new", q: "", games: [], tags: [], people: [], seed: 0, [field]: [value] })}`;
}
