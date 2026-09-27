import { describe, expect, it } from "bun:test";
import { installMode, isIos } from "./install";

describe("installMode", () => {
  it("prompts where the browser offers one, hints on iOS, hides when installed or impossible", () => {
    expect(installMode({ standalone: true, hasPrompt: true, ios: false })).toBe("hidden");
    expect(installMode({ standalone: true, hasPrompt: false, ios: true })).toBe("hidden");
    expect(installMode({ standalone: false, hasPrompt: true, ios: false })).toBe("prompt");
    expect(installMode({ standalone: false, hasPrompt: false, ios: true })).toBe("ios-hint");
    expect(installMode({ standalone: false, hasPrompt: false, ios: false })).toBe("hidden");
  });
});

describe("isIos", () => {
  it("spots iPhone and iPad, including an iPad that says it's a Mac", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 0)).toBe(false);
    expect(isIos("Mozilla/5.0 (Linux; Android 14) Chrome/126", 5)).toBe(false);
  });
});
