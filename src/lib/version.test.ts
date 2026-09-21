import { describe, expect, it } from "bun:test";
import { APP_NAME } from "@/lib/version";

describe("APP_NAME", () => {
  it("is the application name", () => {
    expect(APP_NAME).toBe("clips");
  });
});
