import { timingSafeEqual } from "node:crypto";

export function isAuthorizedEmit(
  provided: string | string[] | undefined,
  expected: string | undefined,
): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }

  if (provided.length === 0 || expected.length === 0) {
    return false;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
