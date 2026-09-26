/** A person's page. Encoded, so a username like `a+b` or `a/b` still lands there. */
export function profileHref(username: string): string {
  return `/u/${encodeURIComponent(username)}`;
}

/** The username a `/u/[username]` segment names. A malformed escape is taken literally. */
export function usernameFromParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

/** The letter on an avatar with no picture. Code points, so an emoji stays whole. */
export function initialOf(name: string): string {
  const [first] = [...name.trim()];
  return first ? first.toUpperCase() : "?";
}
