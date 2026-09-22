import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/db/client";
import { getClip } from "@/db/clips";
import { clipPublicPath } from "@/lib/media/paths";
import { formatDuration } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ClipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const clip = getClip(getDb(), id);

  if (!clip || clip.status !== "ready") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← back
      </Link>
      <h1 className="mt-4 text-xl font-semibold text-ink">{clip.title}</h1>
      <p className="mb-4 text-sm text-ink-muted">
        {formatDuration(clip.durationMs)}
        {clip.width && clip.height ? ` · ${clip.width}×${clip.height}` : ""}
      </p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        className="w-full rounded-lg bg-black"
        src={clipPublicPath(clip.id)}
        controls
        preload="metadata"
      />
    </main>
  );
}
