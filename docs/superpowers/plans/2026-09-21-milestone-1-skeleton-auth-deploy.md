# Milestone 1: Skeleton, Auth, and Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get an empty but real, SSO-protected site answering on `https://clips.oneroomgaming.com`, with the two-process topology, the Docker image, the release pipeline, and Authentik identity all working end to end.

**Architecture:** One Next 16 app and one tiny websocket service, built into a single Docker image and run as two containers that differ only by their `command`. Identity comes from `X-Authentik-Username` headers injected by Caddy's `forward_auth`; the app never handles a password. SQLite holds a `users` table and nothing else yet.

**Tech Stack:** Next 16.3.5, React 19.3.0, Tailwind 4.3.3, TypeScript 5, bun runtime, `bun:sqlite` + Drizzle 0.45.3, `ws` 8.21.3, `bun test`, Docker, Caddy, Authentik.

**Spec:** `docs/superpowers/specs/2026-09-21-clips-site-design.md`

## Global Constraints

- Next `16.3.5`, React `19.3.0`, React DOM `19.3.0`, Tailwind `4.3.3`, `@tailwindcss/postcss` `4.3.3`, TypeScript `^5`.
- Drizzle ORM `0.45.3`, drizzle-kit `0.31.11`, `ws` `8.21.3`, `ulid` `3.0.2`.
- Runtime is **bun** (`oven/bun:1`). Do not add Node-only native modules.
- Tests use **`bun test`**, not Vitest. Vitest executes tests under Node, where `import { Database } from "bun:sqlite"` cannot resolve — every database test would fail to import. Test files import from `"bun:test"`.
- Published image is `samikool/clips` (`:<version>` and `:latest`).
- `web` listens on `:3000`, `realtime` on `:3001`. **Neither container publishes a port.** Both join the external `proxy` network.
- The app trusts `X-Authentik-*` headers. This is only safe because the containers are unreachable except through Caddy. Never add a `ports:` entry.
- Tailwind 4 uses CSS-first config. **Do not create `tailwind.config.js`.**
- No secrets in the repo. Secrets come from environment variables.
- Every task ends with a commit.

## Deviations from the spec (accepted)

1. **`bun:sqlite` instead of `better-sqlite3`.** The spec named `better-sqlite3`. `better-sqlite3` is a native N-API module that would need a compile toolchain in the `oven/bun:1` image. `bun:sqlite` is built in, is officially supported by Drizzle via `drizzle-orm/bun-sqlite`, and removes the build step entirely. The `Db` type is the only thing that leaks, so reversing this is one file.
2. **Public auth hostname is `auth.oneroomgaming.com`.** Decided after the spec was written. `auth.morganmv.net` resolves to `192.168.3.54`, so external users cannot reach it; without a public auth hostname nobody but Sam can log in.

## Known risks

- **Dynamic public IP.** The A records point at Sam's public IP. If it is not static, the site breaks on renewal. No DDNS exists (the Cloudflare API token is scoped to `morganmv.net`). Flagged in Task 10; not solved here.
- **Six vhosts without `private_only`** (`bazarr`, `grabarr`, `mealie`, `seerr`, `radarr`, `sonarr`) become internet-reachable once ports are forwarded. They remain SSO-gated. Deliberately **out of scope** — follow-up work.
- **Caddy directive ordering.** The clips vhost mixes an imported `route` with `handle` blocks. Task 9 includes a `caddy validate` gate because getting this wrong silently bypasses auth.

## File Structure

```
clips.oneroomgaming.com/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── drizzle.config.ts
├── Dockerfile
├── .dockerignore
├── drizzle/                        generated migration SQL
├── .github/workflows/ci.yml
├── .github/workflows/release.yml
└── src/
    ├── app/
    │   ├── layout.tsx              root layout, imports globals.css
    │   ├── globals.css             @import "tailwindcss"
    │   ├── page.tsx                home page, shows the signed-in user
    │   └── api/healthz/route.ts    container healthcheck
    ├── lib/
    │   ├── auth.ts                 parseAuthentikHeaders — pure, no I/O
    │   └── session.ts              requireUser — headers + DB, Next-only
    ├── db/
    │   ├── schema.ts               Drizzle table definitions
    │   ├── client.ts               connection + migration runner
    │   └── users.ts                upsertUser
    └── realtime/
        ├── index.ts                process entrypoint, HTTP + WS wiring
        ├── hub.ts                  socket registry and broadcast — pure-ish
        └── emit-auth.ts            shared-secret check — pure
```

**Boundary rules:** `src/lib/auth.ts` is pure and imported by both processes, so it must never import `next/*` or touch the DB. `src/lib/session.ts` is the Next-only wrapper. `src/realtime/*` must never import `next/*`, because it is bundled separately by `bun build`.

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Create: `src/lib/version.ts`
- Test: `src/lib/version.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `bun run test` / `bun run build`, the `@/*` → `src/*` path alias, and Tailwind 4 wired up.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "clips",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "bun --bun next dev -H 0.0.0.0",
    "build": "next build",
    "start": "next start",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "drizzle-orm": "0.45.3",
    "next": "16.3.5",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "ulid": "3.0.2",
    "ws": "8.21.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "@types/bun": "latest",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/ws": "8.18.1",
    "drizzle-kit": "0.31.11",
    "tailwindcss": "4.3.3",
    "typescript": "^5"
  }
}
```

The `dev` script uses `bun --bun` so local development runs on the same runtime as production. Without it, `next dev` runs under Node and `bun:sqlite` imports fail.

`-H 0.0.0.0` is required. This repo lives on a headless box and is viewed from a different machine; a loopback-bound dev server is unreachable.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "types": ["bun"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts` and `postcss.config.mjs`**

`next.config.ts` — note there is **no** `rewrites` block. Unlike grabarr, nothing proxies through Next here; Caddy routes `/ws` and `/media` itself.

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.3.54"],
  agentRules: false,
};

export default nextConfig;
```

`allowedDevOrigins` is required for development only. Next 16 blocks cross-origin
access to dev resources by default, which silently disables hot reload when the
dev server is viewed from another machine. It has no effect on a production build.

`agentRules: false` stops Next from generating `AGENTS.md` and `CLAUDE.md` into the
repo root on every dev start. Those files are Next's own scaffolding, not this
project's documentation, and letting them regenerate creates permanent untracked
churn.

`postcss.config.mjs`:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

There is no test config file. `bun test` discovers `*.test.ts` automatically and resolves the `@/*` alias from `tsconfig.json` paths.

- [ ] **Step 4: Write the failing test**

Create `src/lib/version.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { APP_NAME } from "@/lib/version";

describe("APP_NAME", () => {
  it("is the application name", () => {
    expect(APP_NAME).toBe("clips");
  });
});
```

- [ ] **Step 5: Install dependencies and run the test to verify it fails**

Run:
```bash
bun install
bun run test
```
Expected: FAIL — the import of `@/lib/version` cannot be resolved. This failure proves both the test runner and the `@` alias are wired; a passing test here would mean the test file was not picked up at all.

- [ ] **Step 6: Write the minimal implementation**

Create `src/lib/version.ts`:

```ts
export const APP_NAME = "clips";
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun run test`
Expected: PASS, 1 test.

- [ ] **Step 8: Create the app shell**

`src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-surface: #0b0d10;
  --color-surface-raised: #14181d;
  --color-ink: #e6e9ee;
  --color-ink-muted: #9aa4b2;
}

body {
  background: var(--color-surface);
  color: var(--color-ink);
}
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "clips",
  description: "Game clips for one room gaming",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` — a placeholder, replaced in Task 4:

```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">clips</h1>
    </main>
  );
}
```

- [ ] **Step 9: Verify the production build works**

Run: `bun run build`
Expected: build succeeds and prints a route list including `/`. If it fails on Tailwind, confirm there is no `tailwind.config.js` — Tailwind 4 does not use one.

- [ ] **Step 10: Create `.gitignore` additions and commit**

Append to the existing `.gitignore` (it already has `.superpowers/`, `node_modules/`, `.next/`, `.env*`, `*.db`):

```
/data
next-env.d.ts
```

```bash
git add -A
git commit -m "feat: scaffold Next 16 app with Tailwind 4 and bun test"
```

---

### Task 2: Authentik header parsing

**Files:**
- Create: `src/lib/auth.ts`
- Test: `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AuthenticatedUser = { username: string; email: string | null; displayName: string | null }`
  - `class MissingAuthHeadersError extends Error`
  - `function parseAuthentikHeaders(headers: Headers | Record<string, string | string[] | undefined>): AuthenticatedUser`

This is the security boundary of the whole application, so it is a pure function with no I/O and is tested hard. It accepts both a `Headers` object (Next) and a plain object (`node:http` in the realtime service) so both processes share one implementation.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/auth.test.ts`:

```ts
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
```

The array case is not hypothetical: `node:http` represents repeated headers as arrays, and taking the last element instead of the first would let a duplicated header override the one Caddy set.

The implementation must duck-type the `Headers` case by checking for a `.get` method rather than using `instanceof Headers`. Next's `headers()` returns a `ReadonlyHeaders` adapter, and relying on `instanceof` across that boundary is the kind of thing that works in tests and fails in production.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/lib/auth.test.ts`
Expected: FAIL — the module `@/lib/auth` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth.ts`:

```ts
export type AuthenticatedUser = {
  username: string;
  email: string | null;
  displayName: string | null;
};

export class MissingAuthHeadersError extends Error {
  constructor() {
    super(
      "No X-Authentik-Username header on the request. This request did not come through Caddy's forward_auth.",
    );
    this.name = "MissingAuthHeadersError";
  }
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

const USERNAME_HEADER = "x-authentik-username";
const EMAIL_HEADER = "x-authentik-email";
const NAME_HEADER = "x-authentik-name";

function isHeaders(headers: HeaderBag): headers is Headers {
  return typeof (headers as Headers).get === "function";
}

function readHeader(headers: HeaderBag, key: string): string | null {
  const raw = isHeaders(headers) ? headers.get(key) : headers[key];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function parseAuthentikHeaders(headers: HeaderBag): AuthenticatedUser {
  const username = readHeader(headers, USERNAME_HEADER);

  if (username === null) {
    throw new MissingAuthHeadersError();
  }

  return {
    username,
    email: readHeader(headers, EMAIL_HEADER),
    displayName: readHeader(headers, NAME_HEADER),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test src/lib/auth.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: parse Authentik forward-auth headers"
```

---

### Task 3: Database, users table, and upsert

**Files:**
- Create: `drizzle.config.ts`, `src/db/schema.ts`, `src/db/client.ts`, `src/db/users.ts`
- Create: `drizzle/` (generated)
- Test: `src/db/users.test.ts`

**Interfaces:**
- Consumes: `AuthenticatedUser` from `src/lib/auth.ts`.
- Produces:
  - `users` table (Drizzle), `type User = typeof users.$inferSelect`
  - `function createDb(path?: string): Db` — creates a connection and runs migrations
  - `function getDb(): Db` — process-wide singleton
  - `type Db`
  - `function upsertUser(db: Db, identity: AuthenticatedUser, now?: Date): User`

- [ ] **Step 1: Create the schema**

Create `src/db/schema.ts`. Only `users` exists in this milestone; the rest of the spec's tables arrive in Milestone 2.

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  authentikUsername: text("authentik_username").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
});

export type User = typeof users.$inferSelect;
```

- [ ] **Step 2: Create the drizzle-kit config and generate the migration**

Create `drizzle.config.ts`:

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
```

Run: `bun run db:generate`
Expected: a new `drizzle/0000_*.sql` and `drizzle/meta/` are written. Open the SQL and confirm it contains `CREATE TABLE \`users\`` and a unique index on `authentik_username`.

- [ ] **Step 3: Create the database client**

Create `src/db/client.ts`. Migrations run on connect so a fresh deployment needs no separate migrate step.

```ts
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const DEFAULT_PATH = process.env.DATABASE_PATH ?? "./data/clips.db";
const MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER ?? "./drizzle";

export type Db = BunSQLiteDatabase<typeof schema>;

export function createDb(path: string = DEFAULT_PATH): Db {
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
```

- [ ] **Step 4: Write the failing tests**

Create `src/db/users.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("upsertUser", () => {
  it("creates a user on first sight", () => {
    const user = upsertUser(db, {
      username: "sam",
      email: "sam@example.com",
      displayName: "Sam Morgan",
    });

    expect(user.authentikUsername).toBe("sam");
    expect(user.email).toBe("sam@example.com");
    expect(user.displayName).toBe("Sam Morgan");
    expect(user.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("returns the same row on a second sight rather than creating a duplicate", () => {
    const first = upsertUser(db, { username: "sam", email: null, displayName: null });
    const second = upsertUser(db, { username: "sam", email: null, displayName: null });

    expect(second.id).toBe(first.id);
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
  });

  it("advances lastSeenAt on a repeat sight", () => {
    const earlier = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-02T00:00:00Z");

    upsertUser(db, { username: "sam", email: null, displayName: null }, earlier);
    const seen = upsertUser(db, { username: "sam", email: null, displayName: null }, later);

    expect(seen.lastSeenAt.getTime()).toBe(later.getTime());
    expect(seen.createdAt.getTime()).toBe(earlier.getTime());
  });

  it("updates email and display name when Authentik supplies new values", () => {
    upsertUser(db, { username: "sam", email: "old@example.com", displayName: "Old" });
    const updated = upsertUser(db, {
      username: "sam",
      email: "new@example.com",
      displayName: "New",
    });

    expect(updated.email).toBe("new@example.com");
    expect(updated.displayName).toBe("New");
  });

  it("keeps existing email and display name when Authentik omits them", () => {
    upsertUser(db, { username: "sam", email: "sam@example.com", displayName: "Sam" });
    const updated = upsertUser(db, { username: "sam", email: null, displayName: null });

    expect(updated.email).toBe("sam@example.com");
    expect(updated.displayName).toBe("Sam");
  });

  it("keeps distinct users separate", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null });
    const dave = upsertUser(db, { username: "dave", email: null, displayName: null });

    expect(sam.id).not.toBe(dave.id);
  });
});
```

The "keeps existing values when Authentik omits them" case matters because Authentik only sends `X-Authentik-Email` when the user has one set; a naive upsert would blank out good data on the next request.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `bun run test src/db/users.test.ts`
Expected: FAIL — the module `@/db/users` cannot be resolved.

- [ ] **Step 6: Write the implementation**

Create `src/db/users.ts`:

```ts
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { users, type User } from "./schema";
import type { AuthenticatedUser } from "@/lib/auth";

export function upsertUser(
  db: Db,
  identity: AuthenticatedUser,
  now: Date = new Date(),
): User {
  const existing = db
    .select()
    .from(users)
    .where(eq(users.authentikUsername, identity.username))
    .get();

  if (existing) {
    return db
      .update(users)
      .set({
        email: identity.email ?? existing.email,
        displayName: identity.displayName ?? existing.displayName,
        lastSeenAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(users)
    .values({
      id: ulid(),
      authentikUsername: identity.username,
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: null,
      createdAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get();
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run test`
Expected: PASS, all tests across all files.

- [ ] **Step 8: Commit**

```bash
git add drizzle.config.ts drizzle/ src/db/
git commit -m "feat: add SQLite users table and upsert on Authentik identity"
```

---

### Task 4: Session helper and the home page

**Files:**
- Create: `src/lib/session.ts`
- Modify: `src/app/page.tsx`
- Create: `src/app/api/healthz/route.ts`
- Test: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: `parseAuthentikHeaders`, `MissingAuthHeadersError`, `getDb`, `upsertUser`.
- Produces:
  - `function resolveIdentity(headers: Headers, env?: NodeJS.ProcessEnv): AuthenticatedUser` — pure, testable, applies the dev fallback
  - `function requireUser(): Promise<User>` — Next server-component helper

`resolveIdentity` exists so the dev-fallback logic is testable without mocking `next/headers`. `requireUser` is the thin untested wrapper.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/session.test.ts`:

```ts
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
```

The second test is the important one: it proves `DEV_AUTH_USERNAME` cannot be used to impersonate anyone on a production deployment, even if the variable leaks into the environment.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/lib/session.test.ts`
Expected: FAIL — the module `@/lib/session` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/lib/session.ts`:

```ts
import { headers } from "next/headers";
import {
  MissingAuthHeadersError,
  parseAuthentikHeaders,
  type AuthenticatedUser,
} from "@/lib/auth";
import { getDb } from "@/db/client";
import { upsertUser } from "@/db/users";
import type { User } from "@/db/schema";

export function resolveIdentity(
  requestHeaders: Headers,
  env: NodeJS.ProcessEnv = process.env,
): AuthenticatedUser {
  try {
    return parseAuthentikHeaders(requestHeaders);
  } catch (error) {
    if (!(error instanceof MissingAuthHeadersError)) {
      throw error;
    }

    const fallback = env.DEV_AUTH_USERNAME?.trim();

    if (env.NODE_ENV !== "production" && fallback) {
      return { username: fallback, email: null, displayName: fallback };
    }

    throw error;
  }
}

export async function requireUser(): Promise<User> {
  const identity = resolveIdentity(await headers());
  return upsertUser(getDb(), identity);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test src/lib/session.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Replace the home page**

Replace `src/app/page.tsx`:

```tsx
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">clips</h1>
      <p className="mt-4 text-[var(--color-ink-muted)]">
        Signed in as{" "}
        <span className="text-[var(--color-ink)]">
          {user.displayName ?? user.authentikUsername}
        </span>
        .
      </p>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Nothing here yet — uploads land in milestone 3.
      </p>
    </main>
  );
}
```

`force-dynamic` is required. Without it Next attempts to prerender this page at build time, where no request headers exist and the build fails.

- [ ] **Step 6: Create the health endpoint**

Create `src/app/api/healthz/route.ts`. It must **not** call `requireUser` — the container healthcheck bypasses Caddy and has no Authentik headers.

```ts
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
```

- [ ] **Step 7: Verify locally**

Run:
```bash
DEV_AUTH_USERNAME=localdev bun run dev
```
Then in another shell:
```bash
curl -s localhost:3000/api/healthz
curl -s localhost:3000 | grep -o "Signed in as"
```
Expected: `{"status":"ok"}` and a match for `Signed in as`. A `./data/clips.db` file should now exist.

- [ ] **Step 8: Verify the build still passes, then commit**

Run: `bun run build && bun run test`
Expected: both succeed.

```bash
git add src/lib/session.ts src/lib/session.test.ts src/app/
git commit -m "feat: resolve signed-in user from Authentik headers"
```

---

### Task 5: The realtime service

**Files:**
- Create: `src/realtime/emit-auth.ts`, `src/realtime/hub.ts`, `src/realtime/index.ts`
- Test: `src/realtime/emit-auth.test.ts`, `src/realtime/hub.test.ts`

**Interfaces:**
- Consumes: `parseAuthentikHeaders`, `MissingAuthHeadersError` from `src/lib/auth.ts`.
- Produces:
  - `function isAuthorizedEmit(provided: string | string[] | undefined, expected: string | undefined): boolean`
  - `class Hub` with `add(socket: Sendable, username: string): void`, `remove(socket: Sendable): void`, `broadcast(message: unknown): number`, `get size(): number`
  - `type Sendable = { send(data: string): void }`

This service must never import `next/*` — it is bundled independently by `bun build` in Task 6.

- [ ] **Step 1: Write the failing emit-auth tests**

Create `src/realtime/emit-auth.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { isAuthorizedEmit } from "@/realtime/emit-auth";

describe("isAuthorizedEmit", () => {
  it("accepts a matching secret", () => {
    expect(isAuthorizedEmit("correct-horse", "correct-horse")).toBe(true);
  });

  it("rejects a mismatched secret", () => {
    expect(isAuthorizedEmit("wrong", "correct-horse")).toBe(false);
  });

  it("rejects a missing secret on the request", () => {
    expect(isAuthorizedEmit(undefined, "correct-horse")).toBe(false);
  });

  it("rejects when the server has no secret configured", () => {
    expect(isAuthorizedEmit("anything", undefined)).toBe(false);
  });

  it("rejects when the server secret is empty", () => {
    expect(isAuthorizedEmit("", "")).toBe(false);
  });

  it("rejects an array-valued header", () => {
    expect(isAuthorizedEmit(["correct-horse", "extra"], "correct-horse")).toBe(false);
  });

  it("rejects a secret that is a prefix of the expected value", () => {
    expect(isAuthorizedEmit("correct", "correct-horse")).toBe(false);
  });
});
```

"No secret configured rejects everything" is deliberate: a misconfigured deploy must fail closed, not open.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/realtime/emit-auth.test.ts`
Expected: FAIL — the module `@/realtime/emit-auth` cannot be resolved.

- [ ] **Step 3: Write the emit-auth implementation**

Create `src/realtime/emit-auth.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

export function isAuthorizedEmit(
  provided: string | string[] | undefined,
  expected: string | undefined,
): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }

  if (provided.length === 0 || expected.length === 0) {
    return false;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
```

The explicit length check is required — `timingSafeEqual` throws on mismatched lengths rather than returning false.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test src/realtime/emit-auth.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing hub tests**

Create `src/realtime/hub.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Hub, type Sendable } from "@/realtime/hub";

function fakeSocket() {
  const sent: string[] = [];
  return { sent, socket: { send: (data: string) => sent.push(data) } satisfies Sendable };
}

describe("Hub", () => {
  it("starts empty", () => {
    expect(new Hub().size).toBe(0);
  });

  it("counts added sockets", () => {
    const hub = new Hub();
    hub.add(fakeSocket().socket, "sam");
    hub.add(fakeSocket().socket, "dave");

    expect(hub.size).toBe(2);
  });

  it("broadcasts a serialised message to every socket", () => {
    const hub = new Hub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add(a.socket, "sam");
    hub.add(b.socket, "dave");

    const delivered = hub.broadcast({ t: "hello" });

    expect(delivered).toBe(2);
    expect(a.sent).toEqual(['{"t":"hello"}']);
    expect(b.sent).toEqual(['{"t":"hello"}']);
  });

  it("stops sending to a removed socket", () => {
    const hub = new Hub();
    const a = fakeSocket();
    hub.add(a.socket, "sam");
    hub.remove(a.socket);

    expect(hub.broadcast({ t: "hello" })).toBe(0);
    expect(a.sent).toEqual([]);
  });

  it("keeps delivering to healthy sockets when one throws", () => {
    const hub = new Hub();
    const healthy = fakeSocket();
    hub.add({ send: () => { throw new Error("socket closed"); } }, "broken");
    hub.add(healthy.socket, "sam");

    expect(hub.broadcast({ t: "hello" })).toBe(1);
    expect(healthy.sent).toEqual(['{"t":"hello"}']);
  });

  it("drops a socket that threw on send", () => {
    const hub = new Hub();
    hub.add({ send: () => { throw new Error("socket closed"); } }, "broken");

    hub.broadcast({ t: "hello" });

    expect(hub.size).toBe(0);
  });
});
```

The last two tests encode the rule that one dead socket must not stop delivery to everyone else — the failure mode where a single stale connection silently breaks the whole room.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun run test src/realtime/hub.test.ts`
Expected: FAIL — the module `@/realtime/hub` cannot be resolved.

- [ ] **Step 7: Write the hub implementation**

Create `src/realtime/hub.ts`:

```ts
export type Sendable = { send(data: string): void };

export class Hub {
  readonly #sockets = new Map<Sendable, string>();

  add(socket: Sendable, username: string): void {
    this.#sockets.set(socket, username);
  }

  remove(socket: Sendable): void {
    this.#sockets.delete(socket);
  }

  get size(): number {
    return this.#sockets.size;
  }

  broadcast(message: unknown): number {
    const payload = JSON.stringify(message);
    let delivered = 0;

    for (const socket of [...this.#sockets.keys()]) {
      try {
        socket.send(payload);
        delivered += 1;
      } catch {
        this.#sockets.delete(socket);
      }
    }

    return delivered;
  }
}
```

The iteration copies the key list because `broadcast` deletes from the map while iterating.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun run test src/realtime/`
Expected: PASS, 13 tests.

- [ ] **Step 9: Write the service entrypoint**

Create `src/realtime/index.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { MissingAuthHeadersError, parseAuthentikHeaders } from "@/lib/auth";
import { isAuthorizedEmit } from "./emit-auth";
import { Hub } from "./hub";

const PORT = Number(process.env.REALTIME_PORT ?? 3001);
const EMIT_SECRET = process.env.EMIT_SECRET;
const MAX_EMIT_BYTES = 64 * 1024;

const hub = new Hub();

class EmitBodyTooLargeError extends Error {
  constructor() {
    super("emit body too large");
    this.name = "EmitBodyTooLargeError";
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let aborted = false;
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      if (aborted) {
        return;
      }

      size += chunk.length;

      if (size > MAX_EMIT_BYTES) {
        aborted = true;
        chunks.length = 0;
        request.resume();
        reject(new EmitBodyTooLargeError());
        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!aborted) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    request.on("error", reject);
  });
}

async function handleEmit(request: IncomingMessage, response: ServerResponse) {
  if (!isAuthorizedEmit(request.headers["x-emit-secret"], EMIT_SECRET)) {
    response.writeHead(403).end();
    return;
  }

  try {
    const delivered = hub.broadcast(JSON.parse(await readBody(request)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ delivered }));
  } catch (error) {
    const status = error instanceof EmitBodyTooLargeError ? 413 : 400;
    response.writeHead(status, { connection: "close" }).end();
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", sockets: hub.size }));
    return;
  }

  if (request.method === "POST" && request.url === "/emit") {
    void handleEmit(request, response);
    return;
  }

  response.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  let username: string;

  try {
    username = parseAuthentikHeaders(request.headers).username;
  } catch (error) {
    const status = error instanceof MissingAuthHeadersError
      ? "401 Unauthorized"
      : "500 Internal Server Error";
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    hub.add(ws, username);
    ws.send(JSON.stringify({ t: "hello", username, serverTime: Date.now() }));
    ws.on("close", () => hub.remove(ws));
    ws.on("error", () => hub.remove(ws));
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`realtime listening on :${PORT}`);
});
```

The upgrade handler rejects unauthenticated sockets with a raw 401 because at that point there is no `ServerResponse` to write to — the connection has already been hijacked. It must **not** rethrow on unexpected errors: `upgrade` is a synchronous `EventEmitter` listener, so a throw becomes an uncaught exception and takes down the whole process — every open socket with it. A process whose entire purpose is staying responsive must not have that path.

`readBody` must **not** call `request.destroy()` on an oversized body. `request` and `response` share one TCP socket, so destroying the request tears down the response too and the caller gets a connection reset instead of a diagnosable status. Drain with `request.resume()` instead, drop the buffered chunks, and let the handler write `413`.

- [ ] **Step 9b: Add a regression test for the oversized body**

Create `src/realtime/index.test.ts`. This is the one integration-level test in the service; the pure modules are covered by their own unit tests.

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const PORT = 3099;
let server: { stop(): void };

beforeAll(async () => {
  process.env.EMIT_SECRET = "test-secret";
  process.env.REALTIME_PORT = String(PORT);
  server = (await import("./index")).server as unknown as { stop(): void };
  await Bun.sleep(150);
});

afterAll(() => {
  server?.stop?.();
});

describe("POST /emit", () => {
  it("answers 413 with a readable response when the body exceeds the cap", async () => {
    const response = await fetch(`http://localhost:${PORT}/emit`, {
      method: "POST",
      headers: { "X-Emit-Secret": "test-secret" },
      body: "x".repeat(70 * 1024),
    });

    expect(response.status).toBe(413);
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const response = await fetch(`http://localhost:${PORT}/emit`, {
      method: "POST",
      headers: { "X-Emit-Secret": "test-secret" },
      body: "not json",
    });

    expect(response.status).toBe(400);
  });
});
```

For this to be importable, `index.ts` must export its server handle (`export const server = createServer(...)`). The oversized-body bug was invisible to the suite precisely because nothing tested this file.

- [ ] **Step 10: Verify the service runs**

Run in one shell:
```bash
EMIT_SECRET=testsecret bun src/realtime/index.ts
```
In another:
```bash
curl -s localhost:3001/healthz
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3001/emit -d '{"t":"x"}'
curl -s -X POST localhost:3001/emit -H 'X-Emit-Secret: testsecret' -d '{"t":"x"}'
```
Expected: `{"status":"ok","sockets":0}`, then `403`, then `{"delivered":0}`.

- [ ] **Step 11: Commit**

```bash
git add src/realtime/
git commit -m "feat: add realtime websocket service with authenticated emit"
```

---

### Task 6: Dockerfile

**Files:**
- Create: `Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: everything built so far.
- Produces: an image running `bun server.js` by default and `bun realtime.js` when overridden.

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
.git
.github
.superpowers
docs
data
*.db
*.db-*
.env
.env.*
README.md
```

The `.env` exclusions are not optional. The builder stage runs `COPY . .` followed by
`bun run build`, and `next build` inlines any `NEXT_PUBLIC_*` variable into the client
bundle — which is then copied into the runtime image and served to browsers. Without
these rules, a stray local `.env` present during a build gets baked into a published
image. `.gitignore` does not protect you here: Docker's build context is the working
directory, not the git index.

- [ ] **Step 2: Create the `Dockerfile`**

```dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build
RUN bun build src/realtime/index.ts --target=bun --outfile=realtime.js

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/realtime.js ./realtime.js
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3000 3001
CMD ["bun", "server.js"]
```

Notes for the implementer:
- `bun build --target=bun --outfile=realtime.js` produces one self-contained file with `ws` bundled in, so the runner needs no `node_modules` for the realtime process.
- `drizzle/` is copied because `createDb` runs migrations at startup from `./drizzle`.
- `ffmpeg` is installed now even though nothing uses it until Milestone 2, so the image is correct from the start and Milestone 2 does not touch this file.
- `public/` must exist or the `COPY` fails. Create `public/.gitkeep` if the directory is empty.

- [ ] **Step 3: Create `public/.gitkeep`**

```bash
mkdir -p public && touch public/.gitkeep
```

- [ ] **Step 4: Build the image**

Run: `docker build -t clips:dev .`
Expected: build succeeds. If `bun run build` fails inside Docker but worked locally, confirm `.dockerignore` is not excluding `src/`.

- [ ] **Step 5: Verify both entrypoints run from the one image**

Run:
```bash
docker run --rm -d --name clips-web-test -p 127.0.0.1:3000:3000 \
  -e DEV_AUTH_USERNAME= -e DATABASE_PATH=/tmp/clips.db clips:dev
sleep 3
curl -s localhost:3000/api/healthz
docker rm -f clips-web-test

docker run --rm -d --name clips-rt-test -p 127.0.0.1:3001:3001 \
  -e EMIT_SECRET=testsecret clips:dev bun realtime.js
sleep 2
curl -s localhost:3001/healthz
docker rm -f clips-rt-test
```
Expected: `{"status":"ok"}` from the first and `{"status":"ok","sockets":0}` from the second.

This publishes ports **only on the loopback interface and only for this test**. The compose file must never publish ports.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore public/.gitkeep
git commit -m "build: add multi-stage image serving web and realtime from one build"
```

---

### Task 7: CI and release workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the `Dockerfile`.
- Produces: `samikool/clips:<tag>` and `samikool/clips:latest` on Docker Hub for `v*` tags.

These follow `~/git/stream-grabber/.github/workflows/` closely, with one image instead of two and a test step added.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [master, dev]
    tags-ignore: ["**"]
  pull_request:
    branches: [master, dev]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run tests
        run: bun run test

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build . -t clips:ci
```

- [ ] **Step 2: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run tests
        run: bun run test

  release:
    runs-on: ubuntu-latest
    needs: test
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Extract version tag
        id: tag
        run: echo "version=${GITHUB_REF_NAME}" >> $GITHUB_OUTPUT

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            samikool/clips:${{ steps.tag.outputs.version }}
            samikool/clips:latest

      - name: Create GitHub release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true

      - name: Backmerge master into dev
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git fetch origin dev
          git checkout dev
          git merge master --no-edit
          git push origin dev
```

- [ ] **Step 3: Confirm the repository prerequisites**

Manual checks before the first tag:
- A GitHub remote exists and has `master` and `dev` branches (the backmerge step fails without `dev`).
- Repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set.

If `dev` does not exist yet:
```bash
git branch dev && git push -u origin dev
```

- [ ] **Step 4: Commit**

```bash
git add .github/
git commit -m "ci: add build/test workflow and tagged release to Docker Hub"
```

- [ ] **Step 5: Cut the first release**

```bash
git tag v0.1.0 && git push origin v0.1.0
```
Expected: the Release workflow succeeds and **`samikool/clips:v0.1.0`** plus `:latest` appear on Docker Hub. The tag carries the `v` prefix because `GITHUB_REF_NAME` for `refs/tags/v0.1.0` is the literal `v0.1.0` — this matches the existing `samikool/*` images published by `~/git/stream-grabber`, which uses the identical extraction step. Do not strip the prefix; consistency with the other images on the account is worth more than a tidier tag.

Wait for this to go green before starting Task 8 — the compose file pulls this image.

**The `dev` branch must exist before the first tag is pushed.** The workflow's final step backmerges `master` into `dev`, and `git fetch origin dev` fails if the branch is absent. Because that step runs *after* the image push and the GitHub release, a missing `dev` produces a half-succeeded release: the image publishes, then the workflow reports failure.

---

### Task 8: Compose service in `~/git/containers`

**Files:**
- Create: `~/git/containers/clips/clips.yml`
- Create: `~/git/containers/clips/.env`

**Interfaces:**
- Consumes: `samikool/clips:latest`.
- Produces: containers `clips-web` and `clips-realtime` on the `proxy` network, reachable by name from Caddy.

This is a different git repository. Commit there separately.

- [ ] **Step 1: Check how secrets are handled in that repo**

Run:
```bash
cat ~/git/containers/.gitignore
ls -a ~/git/containers/caddy/
```
Expected: confirm whether `.env` files are gitignored. `caddy.yml` references `${CF_API_TOKEN}`, so there is an existing convention — follow it. **Do not commit a secret.**

- [ ] **Step 2: Create the external volume**

```bash
docker volume create clips-data
```

Named volumes in this repo are declared `external: true`, so the volume must exist before the stack starts.

- [ ] **Step 3: Create `~/git/containers/clips/.env`**

```bash
EMIT_SECRET=<generate with: openssl rand -hex 32>
CLIPS_MEDIA_DIR=/absolute/path/to/media
```

`CLIPS_MEDIA_DIR` is where clips live on the host. Sam chooses this; the directory and its `clips/`, `thumbs/`, and `incoming/` subdirectories must exist:

```bash
mkdir -p "$CLIPS_MEDIA_DIR"/{clips,thumbs,incoming}
```

- [ ] **Step 4: Create `~/git/containers/clips/clips.yml`**

```yaml
services:
  clips-web:
    image: samikool/clips:latest
    container_name: clips-web
    restart: unless-stopped
    networks:
      - proxy
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=/data/clips.db
      - MEDIA_ROOT=/media
      - REALTIME_URL=http://clips-realtime:3001
      - EMIT_SECRET=${EMIT_SECRET}
    volumes:
      - clips-data:/data
      - ${CLIPS_MEDIA_DIR}:/media
    healthcheck:
      test: ["CMD", "bun", "-e", "const r = await fetch('http://localhost:3000/api/healthz'); process.exit(r.ok ? 0 : 1)"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  clips-realtime:
    image: samikool/clips:latest
    container_name: clips-realtime
    restart: unless-stopped
    command: ["bun", "realtime.js"]
    networks:
      - proxy
    environment:
      - NODE_ENV=production
      - REALTIME_PORT=3001
      - EMIT_SECRET=${EMIT_SECRET}
    healthcheck:
      test: ["CMD", "bun", "-e", "const r = await fetch('http://localhost:3001/healthz'); process.exit(r.ok ? 0 : 1)"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

networks:
  proxy:
    external: true

volumes:
  clips-data:
    external: true
```

**There is no `ports:` section and there must never be one.** Both services trust `X-Authentik-*` headers; a published port would let anyone on the network set those headers directly and become any user. Unlike `grabarr.yml`, there is also no `build:` — this pulls the published image.

- [ ] **Step 5: Start the stack**

```bash
cd ~/git/containers && ./do.sh start clips
docker ps --filter name=clips
docker logs clips-web --tail 30
docker logs clips-realtime --tail 30
```
Expected: both containers running and healthy. `clips-realtime` logs `realtime listening on :3001`.

- [ ] **Step 6: Verify reachability from inside the network**

```bash
docker exec caddy wget -qO- http://clips-web:3000/api/healthz
docker exec caddy wget -qO- http://clips-realtime:3001/healthz
```
Expected: both return their `{"status":"ok"...}` payloads. If the names do not resolve, confirm both containers joined the `proxy` network.

- [ ] **Step 7: Commit in the containers repo**

```bash
cd ~/git/containers
git add clips/clips.yml
git status --short   # confirm clips/.env is NOT staged
git commit -m "feat: add clips stack pulling samikool/clips"
```

---

### Task 9: Caddy routing, header forwarding, and the public auth host

**Files:**
- Modify: `~/git/containers/caddy/Caddyfile` — the `(authentik_auth)` snippet (~line 25), the `clips.oneroomgaming.com` block (~line 34), plus a new `auth.oneroomgaming.com` block
- Modify: `~/git/containers/caddy/caddy.yml` — add a read-only media mount

**Interfaces:**
- Consumes: `clips-web:3000`, `clips-realtime:3001`, `authentik-server:9000`.
- Produces: `https://clips.oneroomgaming.com` routed and SSO-gated, with `X-Authentik-*` headers reaching the app.

**This file fronts every service on the box. A mistake here takes everything down. Validate before reloading.**

- [ ] **Step 1: Add `copy_headers` to the shared `authentik_auth` snippet**

The snippet currently authenticates but forwards nothing, so `X-Authentik-Username` never reaches any app. Without this change the clips app cannot identify anyone.

Replace the existing snippet:

```
(authentik_auth) {
	route {
		reverse_proxy /outpost.goauthentik.io/* authentik-server:9000
		forward_auth authentik-server:9000 {
			uri /outpost.goauthentik.io/auth/caddy
			copy_headers X-Authentik-Username X-Authentik-Groups X-Authentik-Email X-Authentik-Name X-Authentik-Uid
		}
	}
}
```

This is purely additive — it forwards more headers to every SSO-gated service. Existing apps ignore headers they do not read. The handoff notes at `~/git/containers/authentik/handoff.md` already document this exact change as the intended future state.

- [ ] **Step 2: Add the public auth vhost**

Add a new block. No `cloudflare_tls` — the Cloudflare token is scoped to `morganmv.net`, so this certificate comes from an HTTP-01 or TLS-ALPN challenge.

```
auth.oneroomgaming.com {
	reverse_proxy authentik-server:9000
}
```

This is the login page external users reach. It must not import `private_only` or `authentik_auth`.

- [ ] **Step 3: Replace the `clips.oneroomgaming.com` block**

```
clips.oneroomgaming.com {
	import authentik_auth

	route {
		handle /media/clips/* {
			root * /srv
			file_server
		}
		handle /media/thumbs/* {
			root * /srv
			file_server
		}
		handle /ws* {
			reverse_proxy clips-realtime:3001
		}
		handle {
			reverse_proxy clips-web:3000
		}
	}
}
```

Two things matter here:

- **`import authentik_auth` comes first, and the rest is wrapped in its own `route`.** Both are `route` directives, so they execute in file order — the same reasoning documented in the `private_only` comment at the top of this file. If the auth route did not run first, the whole site would be unauthenticated.
- **Only `/media/clips/*` and `/media/thumbs/*` are served.** `/media/incoming/*` is deliberately absent so partially written uploads are never fetchable.

- [ ] **Step 4: Mount the media directory into Caddy read-only**

Modify `~/git/containers/caddy/caddy.yml`, adding to the `volumes` list:

```yaml
      - ${CLIPS_MEDIA_DIR}:/srv/media:ro
```

And create `~/git/containers/caddy/.env` (or append to it) so the variable resolves:

```bash
CLIPS_MEDIA_DIR=/absolute/path/to/media
```

`:ro` matters — Caddy has no reason to write here, and read-only removes a path from "serve files" to "modify files".

- [ ] **Step 5: Validate the configuration before reloading**

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
```
Expected: `Valid configuration`. **If this fails, fix it before proceeding — do not reload.**

Then confirm the auth route really does sort first:

```bash
docker exec caddy caddy adapt --config /etc/caddy/Caddyfile --pretty \
  | grep -A 5 "clips.oneroomgaming.com"
```
Expected: the `forward_auth`/`authentik` handler appears **before** the `file_server` and `reverse_proxy` handlers. If it does not, the ordering assumption is wrong and auth is being bypassed — stop and reconsider before deploying.

- [ ] **Step 6: Apply**

```bash
cd ~/git/containers && ./do.sh recreate caddy
docker logs caddy --tail 40
```
Expected: no errors. Certificate issuance for the new hostnames will fail until Task 10 is done — that is expected at this point and does not affect other sites.

- [ ] **Step 7: Verify an existing service still works**

Open an existing SSO-gated service (for example `https://sonarr.morganmv.net`) from the LAN. It must still load. This confirms the shared-snippet change broke nothing.

- [ ] **Step 8: Commit in the containers repo**

```bash
cd ~/git/containers
git add caddy/Caddyfile caddy/caddy.yml
git status --short   # confirm no .env is staged
git commit -m "feat: route clips, add public auth host, forward authentik headers"
```

---

### Task 10: Ingress — DNS, port forwarding, and certificates

**Files:** none in any repository. These are manual infrastructure steps.

**Interfaces:**
- Consumes: the Caddy configuration from Task 9.
- Produces: `https://clips.oneroomgaming.com` and `https://auth.oneroomgaming.com` resolving and serving valid certificates from the public internet.

Everything else on this box resolves to `192.168.3.54` and is LAN-only. These two hostnames are the first public ones, so none of the existing DNS or TLS patterns apply.

- [ ] **Step 1: Find the public IP**

```bash
curl -s https://api.ipify.org
```
Record it. **If this address is not static, the site will break when it changes.** There is no DDNS in place and the Cloudflare API token is scoped to `morganmv.net`, so it cannot update `oneroomgaming.com` records. If the IP is dynamic, stop and resolve that first — options are a static IP from the ISP, a separate Cloudflare token scoped to `oneroomgaming.com` driving a DDNS updater, or a Cloudflare Tunnel.

- [ ] **Step 2: Set the DNS records in Cloudflare**

For `oneroomgaming.com`, create or update:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `clips` | the public IP | **DNS only (grey cloud)** |
| A | `auth` | the public IP | **DNS only (grey cloud)** |

Grey cloud is required. Proxied records would put Cloudflare on the video byte path, impose a 100 MB request body cap, and route heavy media through a plan that does not permit it.

Also **remove the existing proxied record** for `clips.oneroomgaming.com` — it currently points at Cloudflare anycast addresses (`104.21.66.194`, `172.67.163.234`).

- [ ] **Step 3: Forward ports on the router**

Forward TCP `80` and TCP `443` to `192.168.3.54`.

Port 80 is required — it is how Caddy completes the ACME HTTP-01 challenge, and DNS-01 is unavailable for this domain.

Be aware this makes every vhost in the Caddyfile reachable by `Host:` header, not only these two. Vhosts importing `private_only` remain protected by source IP. The six that do not (`bazarr`, `grabarr`, `mealie`, `seerr`, `radarr`, `sonarr`) become internet-reachable but stay SSO-gated. This was accepted as out of scope.

- [ ] **Step 4: Verify DNS has propagated**

```bash
dig +short clips.oneroomgaming.com
dig +short auth.oneroomgaming.com
```
Expected: both return the public IP from Step 1 and **no Cloudflare anycast addresses**. If you still see `104.21.*` or `172.67.*`, the proxy is still on or the old record remains.

- [ ] **Step 5: Trigger and verify certificate issuance**

```bash
cd ~/git/containers && ./do.sh restart caddy
docker logs -f caddy | grep -i "certificate\|acme\|error"
```
Expected: `certificate obtained successfully` for both hostnames. Then, **from outside the LAN** (phone on cellular is fine):

```bash
curl -sI https://auth.oneroomgaming.com | head -1
curl -sI https://clips.oneroomgaming.com | head -1
```
Expected: `200` from the auth host, and a `302` from clips redirecting toward the auth host.

Note the Caddy global config sets `protocols h1 h2` — there is no HTTP/3. That is fine and needs no change.

---

### Task 11: Authentik provider and end-to-end verification

**Files:** none in any repository. Authentik UI configuration plus final verification.

**Interfaces:**
- Consumes: everything above.
- Produces: a working login that lands a named user on the clips home page.

The existing Proxy Provider sets its cookie on domain `morganmv.net` and therefore **cannot** issue a session valid for `oneroomgaming.com`. A second provider is required.

Field names vary between Authentik versions — the labels below are a guide, not a guarantee. Match on meaning.

- [ ] **Step 1: Create a Proxy Provider for the new domain**

Admin → Applications → Providers → Create → **Proxy Provider**.

- Name: `oneroomgaming-forward-auth`
- Authorization flow: the same one the existing provider uses
- Mode: **Forward auth (domain level)**
- Authentication URL / External host: `https://auth.oneroomgaming.com`
- Cookie domain: `oneroomgaming.com`

The cookie domain is the critical field. Set to `morganmv.net` it silently fails to authenticate anything on the new domain.

- [ ] **Step 2: Create the Application**

Admin → Applications → Applications → Create.

- Name: `Clips`
- Slug: `clips`
- Provider: `oneroomgaming-forward-auth`

- [ ] **Step 3: Add the provider to the embedded outpost**

Admin → Applications → Outposts → edit the embedded outpost → add `oneroomgaming-forward-auth` to its providers → save.

Confirm the outpost's `authentik_host` is set and reachable. If the embedded outpost cannot serve two hostnames with different cookie domains in this Authentik version, create a second outpost pointed at `https://auth.oneroomgaming.com`. Verify by observation in Step 5 rather than assuming either way.

- [ ] **Step 4: Confirm the account exists**

Ensure Sam's Authentik user exists and is permitted to access the `Clips` application (check any policy bindings on the application).

- [ ] **Step 5: End-to-end verification**

From a **private/incognito window, off the LAN**:

1. Visit `https://clips.oneroomgaming.com`.
2. Expect a redirect to `https://auth.oneroomgaming.com` with a login form.
3. Log in.
4. Expect a redirect back to clips, showing **"Signed in as &lt;your name&gt;"**.

If step 4 shows the raw username instead of a display name, that is fine — `X-Authentik-Name` is optional. If it shows an error about missing headers, `copy_headers` from Task 9 Step 1 did not take effect.

- [ ] **Step 6: Confirm the user row was written**

```bash
docker exec clips-web bun -e "
  const { Database } = require('bun:sqlite');
  const db = new Database('/data/clips.db');
  console.log(db.query('SELECT id, authentik_username, email FROM users').all());
"
```
Expected: one row with the Authentik username. This proves the full chain — Caddy → forward_auth → copy_headers → parse → upsert → SQLite.

- [ ] **Step 7: Verify the websocket path**

From the browser console on `https://clips.oneroomgaming.com`:

```js
const ws = new WebSocket(`wss://${location.host}/ws`);
ws.onmessage = (e) => console.log("message:", e.data);
ws.onclose = (e) => console.log("closed:", e.code);
```
Expected: a `{"t":"hello","username":"...","serverTime":...}` message.

This is the single most important verification in the milestone: it proves `forward_auth` applies to websocket upgrades and that identity survives the upgrade. If the socket closes with 401, Caddy is not forwarding the auth headers on upgrade requests and the realtime design needs revisiting before Milestone 4.

- [ ] **Step 8: Confirm nothing is exposed**

```bash
docker ps --filter name=clips --format '{{.Names}}: {{.Ports}}'
```
Expected: **no published ports on either container.** If any port is listed, remove the `ports:` entry and recreate — the header-trust model is broken until you do.

- [ ] **Step 9: Record the outcome**

Append a short "Milestone 1 complete" note to `docs/superpowers/specs/2026-09-21-clips-site-design.md` or a new `docs/DEPLOYMENT.md` capturing: the public IP used, whether a second Authentik outpost was needed, and whether websocket auth worked on the first try. Milestone 4 depends on that last answer.

```bash
git add docs/
git commit -m "docs: record milestone 1 deployment outcome"
```

---

## Definition of done

- [ ] `bun run test` passes; `bun run build` succeeds
- [ ] `samikool/clips:0.1.0` and `:latest` published to Docker Hub by CI
- [ ] `clips-web` and `clips-realtime` running and healthy, **no published ports**
- [ ] `https://clips.oneroomgaming.com` serves a valid certificate from outside the LAN
- [ ] Logging in shows "Signed in as &lt;name&gt;" and writes a `users` row
- [ ] A websocket to `/ws` receives a `hello` frame carrying the correct username
- [ ] Existing SSO-gated services still work after the `copy_headers` change
