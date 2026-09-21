import { describe, expect, it } from "bun:test";
import { MissingAuthHeadersError } from "@/lib/auth";
import { resolveIdentity } from "@/lib/session";

describe("resolveIdentity", () => {
  it("uses the Authentik headers when present", () => {
    const headers = new Headers({ "X-Authentik-Username": "sam" });

    expect(resolveIdentity(headers, { NODE_ENV: "production" }).username).toBe("sam");
  });

  it("throws in production when headers are missing", () => {
    expect(() =>
      resolveIdentity(new Headers(), {
        NODE_ENV: "production",
        DEV_AUTH_USERNAME: "sneaky",
      }),
    ).toThrow(MissingAuthHeadersError);
  });

  it("falls back to DEV_AUTH_USERNAME outside production", () => {
    const identity = resolveIdentity(new Headers(), {
      NODE_ENV: "development",
      DEV_AUTH_USERNAME: "localdev",
    });

    expect(identity).toEqual({
      username: "localdev",
      email: null,
      displayName: "localdev",
    });
  });

  it("still throws outside production when no fallback is configured", () => {
    expect(() => resolveIdentity(new Headers(), { NODE_ENV: "development" })).toThrow(
      MissingAuthHeadersError,
    );
  });

  it("prefers real headers over the dev fallback", () => {
    const headers = new Headers({ "X-Authentik-Username": "real" });

    expect(
      resolveIdentity(headers, {
        NODE_ENV: "development",
        DEV_AUTH_USERNAME: "fallback",
      }).username,
    ).toBe("real");
  });
});
