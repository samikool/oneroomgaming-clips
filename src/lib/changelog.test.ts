import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareEntries, compareVersions, getChangelogEntries } from "@/lib/changelog";

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

describe("compareVersions", () => {
  it("orders by numeric component, not string", () => {
    // "0.0.10" < "0.0.9" as strings, which is the bug this avoids.
    expect(compareVersions("0.0.10", "0.0.9")).toBeGreaterThan(0);
  });

  it("orders across minor and major", () => {
    expect(compareVersions("0.1.0", "0.0.6")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("is zero for equal versions", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("treats a missing component as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.1", "1.0.5")).toBeGreaterThan(0);
  });

  it("does not crash on a non-numeric version", () => {
    expect(() => compareVersions("weird", "0.1.0")).not.toThrow();
  });
});

describe("compareEntries", () => {
  const e = (version: string, date: string) => ({ version, date: new Date(date) });

  it("puts the newer date first", () => {
    expect(compareEntries(e("0.0.6", "2026-09-24"), e("0.1.0", "2026-09-25"))).toBeGreaterThan(0);
  });

  it("breaks a same-date tie by version, newest first", () => {
    // Not testable through getChangelogEntries: readdirSync returns hash order
    // on ext4, so a fixture-based test passes on the accident of how the
    // filenames hash rather than on the comparator being right.
    expect(compareEntries(e("0.0.5", "2026-09-24"), e("0.0.6", "2026-09-24"))).toBeGreaterThan(0);
    expect(compareEntries(e("0.0.6", "2026-09-24"), e("0.0.5", "2026-09-24"))).toBeLessThan(0);
  });

  it("prefers a newer date even when the version is lower", () => {
    expect(compareEntries(e("0.1.0", "2026-09-01"), e("0.0.1", "2026-09-25"))).toBeGreaterThan(0);
  });

  it("sorts a realistic set correctly", () => {
    const entries = [
      e("0.0.5", "2026-09-24"),
      e("0.1.0", "2026-09-25"),
      e("0.0.3", "2026-09-23"),
      e("0.0.6", "2026-09-24"),
      e("0.0.2", "2026-09-23"),
    ];

    expect([...entries].sort(compareEntries).map((x) => x.version)).toEqual([
      "0.1.0",
      "0.0.6",
      "0.0.5",
      "0.0.3",
      "0.0.2",
    ]);
  });
});
