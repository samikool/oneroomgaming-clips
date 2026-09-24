import Link from "next/link";
import { getDb } from "@/db/client";
import { listAllClips } from "@/db/clips";
import { LiveGrid } from "@/components/live-grid";
import { PresenceBar } from "@/components/presence-bar";
import { toSummary } from "@/lib/events/clips";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const clips = listAllClips(getDb());

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div><p className="mb-1 text-sm text-ink-muted">One Room Gaming</p><h1 className="text-3xl font-semibold tracking-tight text-ink">Clips</h1></div>
        <Link href="/upload" className="button-primary sm:ml-auto">Upload clips</Link>
        <div className="text-right">
          <p className="text-sm text-ink-muted">
            {user.displayName ?? user.authentikUsername}
          </p>
          <PresenceBar me={user.authentikUsername} />
        </div>
      </div>
      <LiveGrid initial={clips.map(toSummary)} />
    </main>
  );
}
