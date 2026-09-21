import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

const DEFAULT_PATH = process.env.DATABASE_PATH ?? "./data/clips.db";
const MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER ?? "./drizzle";

export type Db = BunSQLiteDatabase<typeof schema>;

export function createDb(path: string = DEFAULT_PATH): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return db;
}

let cached: Db | undefined;

export function getDb(): Db {
  cached ??= createDb();
  return cached;
}
