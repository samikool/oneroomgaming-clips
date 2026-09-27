import Link from "next/link";
import { ClipBrowser } from "@/components/browser/clip-browser";
import { DiskUsage } from "@/components/disk-usage";
import { getDb } from "@/db/client";
import { activityScores } from "@/db/activity";
import { listBrowseOptions } from "@/db/browse-options";
import { totalDiskBytes } from "@/db/clips";
import { sinceLastVisit } from "@/db/since";
import { SinceLastVisit } from "@/components/since-last-visit";
import { isAdmin } from "@/lib/auth";
import { parseBrowseQuery, SORTS } from "@/lib/browse/query";
import { browseTabs } from "@/lib/browse/tabs";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const query = parseBrowseQuery(await searchParams);
  const db = getDb();
  // Every tab's first page, so switching tabs never waits on the network.
  const initialPages = browseTabs(db, query, {
    tabs: [...SORTS],
    scope: "home",
    userId: user.id,
    scores: activityScores(db),
  }).tabs;
  const since = sinceLastVisit(db, user);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Clips</h1>
          <p className="mt-1 text-sm text-ink-muted">
            <DiskUsage bytes={totalDiskBytes(db)} />
          </p>
        </div>
        <Link href="/upload" className="button-primary shrink-0">
          Upload clips
        </Link>
      </header>

      {since && <SinceLastVisit data={since} visitKey={user.visitStartedAt?.getTime()} />}

      <ClipBrowser
        initialQuery={query}
        initialPages={initialPages}
        scope="home"
        density="comfortable"
        me={user.authentikUsername}
        options={listBrowseOptions(db)}
        // Delete moves to the admin page later; until then it stays here.
        selection={{ enabled: isAdmin(user.authentikUsername) }}
      />
    </main>
  );
}
