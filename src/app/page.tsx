import { getDb } from "@/db/client";
import { listAllClips } from "@/db/clips";
import { ClipGrid } from "@/components/clip-grid";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const clips = listAllClips(getDb());

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink">clips</h1>
        <p className="text-sm text-ink-muted">
          {user.displayName ?? user.authentikUsername}
        </p>
      </div>
      <ClipGrid clips={clips} />
    </main>
  );
}
