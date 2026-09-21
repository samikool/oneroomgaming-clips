import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getChangelogEntries } from "@/lib/changelog";

describe("getChangelogEntries", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "changelog-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses frontmatter and body", () => {
    writeFileSync(
      join(dir, "0.1.0.md"),
      [
        "---",
        "version: 0.1.0",
        "date: 2026-09-21",
        "title: First light",
        "---",
        "",
        "- Sign in with your One Room Gaming account",
      ].join("\n"),
    );

    const entries = getChangelogEntries(dir);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      version: "0.1.0",
      title: "First light",
    });
    expect(entries[0].date).toBeInstanceOf(Date);
    expect(entries[0].body).toContain("Sign in with your One Room Gaming");
    expect(entries[0].html).toContain("Sign in with your One Room Gaming");
  });

  it("orders entries newest-first", () => {
    writeFileSync(
      join(dir, "0.1.0.md"),
      ["---", "version: 0.1.0", "date: 2026-09-21", "title: First", "---", "", "a"].join(
        "\n",
      ),
    );
    writeFileSync(
      join(dir, "0.2.0.md"),
      ["---", "version: 0.2.0", "date: 2026-10-01", "title: Second", "---", "", "b"].join(
        "\n",
      ),
    );
    writeFileSync(
      join(dir, "0.1.5.md"),
      [
        "---",
        "version: 0.1.5",
        "date: 2026-09-25",
        "title: Middle",
        "---",
        "",
        "c",
      ].join("\n"),
    );

    const entries = getChangelogEntries(dir);

    expect(entries.map((e) => e.version)).toEqual(["0.2.0", "0.1.5", "0.1.0"]);
  });

  it("does not crash the whole load on a malformed or frontmatter-less file", () => {
    writeFileSync(
      join(dir, "0.1.0.md"),
      ["---", "version: 0.1.0", "date: 2026-09-21", "title: Good", "---", "", "ok"].join(
        "\n",
      ),
    );
    writeFileSync(join(dir, "broken.md"), "just some text, no frontmatter at all");

    const entries = getChangelogEntries(dir);

    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe("0.1.0");
  });
});
