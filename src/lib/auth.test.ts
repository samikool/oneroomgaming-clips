import { describe, expect, it } from "bun:test";
import {
  assertAdmin,
  devIdentityOverride,
  isAdmin,
  NotAuthorizedError,
  MissingAuthHeadersError,
  parseAuthentikHeaders,
  resolveIdentity,
} from "@/lib/auth";

describe("parseAuthentikHeaders", () => {
  it("extracts identity from a Headers object", () => {
    const headers = new Headers({
      "X-Authentik-Username": "sam",
      "X-Authentik-Email": "sam@example.com",
      "X-Authentik-Name": "Sam Morgan",
    });

    expect(parseAuthentikHeaders(headers)).toEqual({
      username: "sam",
      email: "sam@example.com",
      displayName: "Sam Morgan",
    });
  });

  it("extracts identity from a plain node:http header bag", () => {
    const headers = {
      "x-authentik-username": "dave",
      "x-authentik-email": "dave@example.com",
      "x-authentik-name": "Dave",
    };

    expect(parseAuthentikHeaders(headers)).toEqual({
      username: "dave",
      email: "dave@example.com",
      displayName: "Dave",
    });
  });

  it("returns null for optional fields that are absent", () => {
    const headers = new Headers({ "X-Authentik-Username": "kel" });

    expect(parseAuthentikHeaders(headers)).toEqual({
      username: "kel",
      email: null,
      displayName: null,
    });
  });

  it("throws when the username header is missing", () => {
    const headers = new Headers({ "X-Authentik-Email": "nobody@example.com" });

    expect(() => parseAuthentikHeaders(headers)).toThrow(MissingAuthHeadersError);
  });

  it("throws when the username header is present but empty", () => {
    const headers = new Headers({ "X-Authentik-Username": "" });

    expect(() => parseAuthentikHeaders(headers)).toThrow(MissingAuthHeadersError);
  });

  it("throws when the username header is only whitespace", () => {
    const headers = new Headers({ "X-Authentik-Username": "   " });

    expect(() => parseAuthentikHeaders(headers)).toThrow(MissingAuthHeadersError);
  });

  it("trims surrounding whitespace from values", () => {
    const headers = new Headers({ "X-Authentik-Username": "  sam  " });

    expect(parseAuthentikHeaders(headers).username).toBe("sam");
  });

  it("takes the first value if a header bag supplies an array (defensive; Node coalesces to a string in practice)", () => {
    const headers = { "x-authentik-username": ["sam", "injected"] };

    expect(parseAuthentikHeaders(headers).username).toBe("sam");
  });

  it("treats a duplicated header coalesced into a comma-joined string as a single junk username (fails safe, matches no real user)", () => {
    const headers = { "x-authentik-username": "sam, injected" };

    expect(parseAuthentikHeaders(headers).username).toBe("sam, injected");
  });
});

describe("resolveIdentity", () => {
  it("uses the Authentik headers when present", () => {
    expect(
      resolveIdentity({ "x-authentik-username": "sam" }, { NODE_ENV: "production" }).username,
    ).toBe("sam");
  });

  it("throws in production when headers are missing, even with a fallback set", () => {
    // The guard is what makes this safe to ship. NODE_ENV=production is set
    // in the Dockerfile and in both compose services.
    expect(() =>
      resolveIdentity({}, { NODE_ENV: "production", DEV_AUTH_USERNAME: "sneaky" }),
    ).toThrow(MissingAuthHeadersError);
  });

  it("falls back to DEV_AUTH_USERNAME outside production", () => {
    expect(
      resolveIdentity({}, { NODE_ENV: "development", DEV_AUTH_USERNAME: "localdev" }),
    ).toEqual({ username: "localdev", email: null, displayName: "localdev" });
  });

  it("still throws outside production when no fallback is configured", () => {
    expect(() => resolveIdentity({}, { NODE_ENV: "development" })).toThrow(
      MissingAuthHeadersError,
    );
  });
});

describe("devIdentityOverride", () => {
  it("reads a username from the query string outside production", () => {
    // Without this there is no way to be two different people in dev, which
    // makes watch-together, presence and chat untestable locally.
    expect(devIdentityOverride("/ws?user=dave", { NODE_ENV: "development" })).toBe("dave");
  });

  it("is ignored in production", () => {
    expect(devIdentityOverride("/ws?user=admin", { NODE_ENV: "production" })).toBeNull();
  });

  it("is null when no user is named", () => {
    expect(devIdentityOverride("/ws", { NODE_ENV: "development" })).toBeNull();
    expect(devIdentityOverride("/ws?user=", { NODE_ENV: "development" })).toBeNull();
  });

  it("survives a url it cannot parse", () => {
    expect(devIdentityOverride(undefined, { NODE_ENV: "development" })).toBeNull();
  });
});

describe("isAdmin", () => {
  it("grants the single configured admin", () => {
    expect(isAdmin("sam", { CLIPS_ADMINS: "sam" })).toBe(true);
  });

  it("refuses a user who is not configured", () => {
    expect(isAdmin("dave", { CLIPS_ADMINS: "sam" })).toBe(false);
  });

  it("grants nobody when CLIPS_ADMINS is unset", () => {
    expect(isAdmin("sam", {})).toBe(false);
  });

  it("grants nobody when CLIPS_ADMINS is empty or only separators", () => {
    expect(isAdmin("sam", { CLIPS_ADMINS: "" })).toBe(false);
    expect(isAdmin("sam", { CLIPS_ADMINS: "  " })).toBe(false);
    expect(isAdmin("sam", { CLIPS_ADMINS: ",,," })).toBe(false);
  });

  it("reads a comma-separated list and ignores surrounding whitespace", () => {
    const env = { CLIPS_ADMINS: " sam , dave " };

    expect(isAdmin("sam", env)).toBe(true);
    expect(isAdmin("dave", env)).toBe(true);
    expect(isAdmin("kel", env)).toBe(false);
  });

  it("never matches the empty username against an empty list entry", () => {
    expect(isAdmin("", { CLIPS_ADMINS: "sam,,dave" })).toBe(false);
  });

  // Exact match on purpose. A case-insensitive compare would grant admin to a
  // different Authentik user whose name differs only in case.
  it("matches case-sensitively", () => {
    expect(isAdmin("Sam", { CLIPS_ADMINS: "sam" })).toBe(false);
  });
});

describe("assertAdmin", () => {
  const sam = { username: "sam", email: null, displayName: null };

  it("returns the user when they are an admin", () => {
    expect(assertAdmin(sam, { CLIPS_ADMINS: "sam" })).toEqual(sam);
  });

  it("throws NotAuthorizedError for a signed-in non-admin", () => {
    expect(() => assertAdmin({ ...sam, username: "dave" }, { CLIPS_ADMINS: "sam" })).toThrow(
      NotAuthorizedError,
    );
  });

  // Fails closed: a deployment that forgot CLIPS_ADMINS disables deletion
  // rather than opening it to everyone.
  it("throws for everyone when CLIPS_ADMINS is unset", () => {
    expect(() => assertAdmin(sam, {})).toThrow(NotAuthorizedError);
  });

  it("does not leak the admin list in the error message", () => {
    let message = "";
    try {
      assertAdmin({ ...sam, username: "dave" }, { CLIPS_ADMINS: "sam,kel" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).not.toContain("sam");
    expect(message).not.toContain("kel");
  });
});
