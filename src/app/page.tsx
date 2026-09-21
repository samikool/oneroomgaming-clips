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
