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
