import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { ClipsPanel } from "@/components/admin/clips-panel";
import { JobsPanel } from "@/components/admin/jobs-panel";
import { VocabPanel } from "@/components/admin/vocab-panel";
import { ADMIN_PAGE_SIZE, CLIP_STATUSES, listAdminClips } from "@/db/admin/clips";
import { listJobs } from "@/db/admin/jobs";
import { avatarsBytes, storageByUploader } from "@/db/admin/storage";
import { listAdminUsers } from "@/db/admin/users";
import { totalDiskBytes } from "@/db/clips";
import { StoragePanel } from "@/components/admin/storage-panel";
import { UsersPanel } from "@/components/admin/users-panel";
import type { ClipStatus, JobStatus } from "@/db/schema";
import { listGamesWithCounts, listTagsWithCounts } from "@/db/admin/games-tags";
import { getDb } from "@/db/client";
import { parseSection, type AdminSection } from "@/lib/admin/sections";
import { isAdmin } from "@/lib/auth";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

const DAY_MS = 86_400_000;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function clipStatus(raw: string): ClipStatus | undefined {
  return (CLIP_STATUSES as string[]).includes(raw) ? (raw as ClipStatus) : undefined;
}

function jobStatus(raw: string): JobStatus | undefined {
  return (["queued", "running", "done", "failed"] as string[]).includes(raw) ? (raw as JobStatus) : undefined;
}

/** Only the selected section's data is loaded. */
function Panel({ section, params }: { section: AdminSection; params: Params }) {
  const db = getDb();

  switch (section) {
    case "clips": {
      const q = one(params.q).trim();
      const status = clipStatus(one(params.status));
      const page = Math.max(0, Number.parseInt(one(params.page), 10) || 0);
      const { rows, total } = listAdminClips(db, { q: q || undefined, status, page });
      return (
        <ClipsPanel rows={rows} total={total} page={page} pageSize={ADMIN_PAGE_SIZE} q={q} status={status ?? ""} />
      );
    }
    case "jobs": {
      const status = jobStatus(one(params.status));
      return <JobsPanel jobs={listJobs(db, { status, sinceMs: Date.now() - DAY_MS })} status={status ?? ""} />;
    }
    case "storage":
      return <StoragePanel total={totalDiskBytes(db)} uploaders={storageByUploader(db)} avatars={avatarsBytes()} />;
    case "users":
      return <UsersPanel users={listAdminUsers(db)} />;
    case "games":
    default:
      return <VocabPanel games={listGamesWithCounts(db)} tags={listTagsWithCounts(db)} />;
  }
}

/** 404, not 403, for everyone else: the page's existence isn't advertised. */
export default async function AdminPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();

  if (!isAdmin(user.authentikUsername)) {
    notFound();
  }

  const params = await searchParams;
  const section = parseSection(params.s);

  return (
    <AdminShell section={section}>
      <Panel section={section} params={params} />
    </AdminShell>
  );
}
