import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { toFtsQuery } from "./fts";

describe("toFtsQuery", () => {
  it("quotes each word as a prefix term, ANDed", () => {
    expect(toFtsQuery("apex sa")).toBe('"apex"* AND "sa"*');
  });

  it("is null for blank input", () => {
    expect(toFtsQuery("   ")).toBeNull();
  });

  it("doubles quotes inside a word", () => {
    expect(toFtsQuery('say"hi')).toBe('"say""hi"*');
  });

  it("never lets input act as FTS syntax", () => {
    const db = new Database(":memory:");
    db.exec('CREATE VIRTUAL TABLE t USING fts5(body, tokenize = "unicode61 remove_diacritics 2")');
    db.exec("INSERT INTO t VALUES ('kobe yelled NEAR the wall')");
    const hostile = ['"', "*", "OR", "NEAR(a b)", "-kobe", "body:kobe", '"unbalanced', "a AND", "(", "^kobe"];
    for (const input of hostile) {
      const match = toFtsQuery(input);
      if (match) {
        expect(() => db.query("SELECT * FROM t WHERE t MATCH ?").all(match)).not.toThrow();
      }
    }
    expect(db.query("SELECT * FROM t WHERE t MATCH ?").all(toFtsQuery("OR")!)).toHaveLength(0);
    expect(db.query("SELECT * FROM t WHERE t MATCH ?").all(toFtsQuery("near")!)).toHaveLength(1);
  });
});
