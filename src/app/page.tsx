import Link from "next/link";
import { DiskUsage } from "@/components/disk-usage";
import { FilterChips } from "@/components/filter-chips";
import { LiveGrid } from "@/components/live-grid";
import { PresenceBar } from "@/components/presence-bar";
import { getDb } from "@/db/client";
import { listClipsForGrid, totalDiskBytes } from "@/db/clips";
import { toSummary } from "@/lib/events/clips";
import { parseFilters } from "@/lib/filters";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const filters = parseFilters(await searchParams);
  const db = getDb();
  const clips = listClipsForGrid(db, filters);
  const filtered = Object.keys(filters).length > 0;

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1 text-sm text-ink-muted">One Room Gaming</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Clips</h1>
          <DiskUsage bytes={totalDiskBytes(db)} />
        </div>
        <Link href="/upload" className="button-primary sm:ml-auto">
          Upload clips
        </Link>
        <div className="text-right">
          <p className="text-sm text-ink-muted">{user.displayName ?? user.authentikUsername}</p>
          <PresenceBar me={user.authentikUsername} />
        </div>
      </div>

      <FilterChips filters={filters} />

      {clips.length === 0 && filtered ? (
        <p className="text-sm text-ink-muted">
          Nothing matches those filters.{" "}
          <Link href="/" className="underline hover:text-ink">
            Clear them
          </Link>
          .
        </p>
      ) : (
        // A filtered grid must not merge live clips that do not match, so the
        // live merge is only enabled on the unfiltered view.
        <LiveGrid initial={clips.map(toSummary)} live={!filtered} />
      )}
    </main>
  );
}
