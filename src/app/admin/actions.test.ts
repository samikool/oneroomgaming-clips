import { describe, expect, it, mock } from "bun:test";
import { NotAuthorizedError } from "@/lib/auth";

// A non-admin POSTing an admin action directly: the page's 404 never ran, so
// the action itself must refuse — before it touches the database.
// bun's module mocks are process-wide, so each keeps the real module's other
// exports: createDb must still work for every db test that runs after this.
let dbTouched = 0;
const realClient = await import("@/db/client");
const realSession = await import("@/lib/session");

mock.module("@/lib/session", () => ({
  ...realSession,
  requireAdmin: async () => {
    throw new NotAuthorizedError();
  },
  requireUser: async () => {
    throw new Error("admin actions must use requireAdmin, not requireUser");
  },
}));
mock.module("@/db/client", () => ({
  ...realClient,
  getDb: () => {
    dbTouched += 1;
    throw new Error("the database was reached before the admin check");
  },
}));

const actions = await import("./actions");

describe("every admin action", () => {
  const entries = Object.entries(actions).filter(([, value]) => typeof value === "function");

  it("exists", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const [name, action] of entries) {
    it(`${name} refuses a non-admin before reading or writing anything`, async () => {
      const before = dbTouched;
      await expect((action as (...args: unknown[]) => Promise<unknown>)("x", "y", true)).rejects.toBeInstanceOf(
        NotAuthorizedError,
      );
      expect(dbTouched).toBe(before);
    });
  }
});
