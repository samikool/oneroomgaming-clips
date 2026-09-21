import { describe, expect, it } from "bun:test";
import { MissingAuthHeadersError, parseAuthentikHeaders } from "@/lib/auth";

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

  it("takes the first value when a header arrives as an array", () => {
    const headers = { "x-authentik-username": ["sam", "injected"] };

    expect(parseAuthentikHeaders(headers).username).toBe("sam");
  });
});
