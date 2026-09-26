import Link from "next/link";
import { DiskUsage } from "@/components/disk-usage";
import { FilterChips } from "@/components/filter-chips";
import { LiveGrid } from "@/components/live-grid";
import { getDb } from "@/db/client";
import { listClipsForGrid, totalDiskBytes } from "@/db/clips";
import { toSummary } from "@/lib/events/clips";
import { isAdmin } from "@/lib/auth";
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
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex items-end justify-between gap-4">
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
        <LiveGrid
          initial={clips.map(toSummary)}
          live={!filtered}
          canSelect={isAdmin(user.authentikUsername)}
        />
      )}
    </main>
  );
}
