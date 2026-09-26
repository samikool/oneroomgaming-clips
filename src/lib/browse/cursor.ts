import type { Sort } from "./query";

/** Opaque to clients. Carries the sort so one tab's cursor can't page another. */
export function encodeCursor(sort: Sort, offset: number): string {
  return Buffer.from(`${sort}:${offset}`).toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined, sort: Sort): number {
  if (!cursor) return 0;
  try {
    const [cursorSort, raw] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
    const offset = Number(raw);
    return cursorSort === sort && Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}
