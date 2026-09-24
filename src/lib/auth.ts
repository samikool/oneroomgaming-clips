export type AuthenticatedUser = {
  username: string;
  email: string | null;
  displayName: string | null;
};

export class MissingAuthHeadersError extends Error {
  constructor() {
    super(
      "No X-Authentik-Username header on the request. This request did not come through Caddy's forward_auth.",
    );
    this.name = "MissingAuthHeadersError";
  }
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

const USERNAME_HEADER = "x-authentik-username";
const EMAIL_HEADER = "x-authentik-email";
const NAME_HEADER = "x-authentik-name";

function isHeaders(headers: HeaderBag): headers is Headers {
  return typeof (headers as Headers).get === "function";
}

function readHeader(headers: HeaderBag, key: string): string | null {
  const raw = isHeaders(headers) ? headers.get(key) : headers[key];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function parseAuthentikHeaders(headers: HeaderBag): AuthenticatedUser {
  const username = readHeader(headers, USERNAME_HEADER);

  if (username === null) {
    throw new MissingAuthHeadersError();
  }

  return {
    username,
    email: readHeader(headers, EMAIL_HEADER),
    displayName: readHeader(headers, NAME_HEADER),
  };
}

/**
 * The identity for a request, with a development fallback.
 *
 * Lives here rather than in `session.ts` because the realtime process needs
 * it too, and `session.ts` imports `next/headers` and the database — neither
 * of which may cross into `src/realtime/`.
 *
 * The fallback is inert in production: `NODE_ENV=production` is set in the
 * Dockerfile and in both compose services, and a missing header throws there
 * however `DEV_AUTH_USERNAME` is set.
 */
export function resolveIdentity(
  headers: HeaderBag,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): AuthenticatedUser {
  try {
    return parseAuthentikHeaders(headers);
  } catch (error) {
    if (!(error instanceof MissingAuthHeadersError)) {
      throw error;
    }

    const fallback = env.DEV_AUTH_USERNAME?.trim();

    if (env.NODE_ENV !== "production" && fallback) {
      return { username: fallback, email: null, displayName: fallback };
    }

    throw error;
  }
}

/**
 * A `?user=` override for local development, so one machine can be two
 * people.
 *
 * Without it every dev tab is `DEV_AUTH_USERNAME`, the room treats them as
 * one person, and watch-together, presence and chat cannot be tested at all.
 * Returns null in production, whatever the query string says.
 */
export function devIdentityOverride(
  url: string | undefined,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string | null {
  if (env.NODE_ENV === "production" || !url) {
    return null;
  }

  try {
    const name = new URL(url, "http://localhost").searchParams.get("user")?.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
