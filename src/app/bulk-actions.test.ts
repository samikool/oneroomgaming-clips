import { describe, expect, it, mock } from "bun:test";
import { NotAuthorizedError } from "@/lib/auth";

let dbTouched = 0;
const realClient = await import("@/db/client");
const realSession = await import("@/lib/session");

mock.module("@/lib/session", () => ({
  ...realSession,
  requireUser: async () => {
    throw new NotAuthorizedError();
  },
}));
mock.module("@/db/client", () => ({
  ...realClient,
  getDb: () => {
    dbTouched += 1;
    throw new Error("the database was reached before the sign-in check");
  },
}));

const actions = await import("./bulk-actions");

describe("bulk actions", () => {
  for (const [name, action] of Object.entries(actions).filter(([, v]) => typeof v === "function")) {
    it(`${name} refuses a signed-out caller before touching anything`, async () => {
      const before = dbTouched;
      await expect((action as (...a: unknown[]) => Promise<unknown>)(["x"], {})).rejects.toBeInstanceOf(NotAuthorizedError);
      expect(dbTouched).toBe(before);
    });
  }
});
