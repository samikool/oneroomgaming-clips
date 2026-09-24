export type ClipFilters = {
  tag?: string;
  game?: string;
  uploader?: string;
  participant?: string;
};

/**
 * The filterable fields, in the order chips render.
 *
 * One list drives parsing, serialising and display, so a new filter is one
 * entry here plus a query clause.
 */
const KEYS = ["tag", "game", "uploader", "participant"] as const;

function first(value: string | string[] | undefined): string | undefined {
  // Next hands back an array for a repeated param. One filter per field keeps
  // both the query and the chips simple.
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): ClipFilters {
  const filters: ClipFilters = {};

  for (const key of KEYS) {
    const value = first(params[key]);

    if (value !== undefined) {
      filters[key] = value;
    }
  }

  return filters;
}

/** A linkable URL. Stable key order, so one filter set is always one URL. */
export function filtersToQuery(filters: ClipFilters): string {
  const query = new URLSearchParams();

  for (const key of KEYS) {
    const value = filters[key];

    if (value !== undefined) {
      query.set(key, value);
    }
  }

  const rendered = query.toString();
  return rendered.length === 0 ? "/" : `/?${rendered}`;
}

export function withFilter(
  filters: ClipFilters,
  key: keyof ClipFilters,
  value: string,
): string {
  return filtersToQuery({ ...filters, [key]: value });
}

export function withoutFilter(filters: ClipFilters, key: keyof ClipFilters): string {
  const next = { ...filters };
  delete next[key];
  return filtersToQuery(next);
}

export function activeFilters(
  filters: ClipFilters,
): { key: keyof ClipFilters; value: string }[] {
  return KEYS.filter((key) => filters[key] !== undefined).map((key) => ({
    key,
    value: filters[key] as string,
  }));
}
