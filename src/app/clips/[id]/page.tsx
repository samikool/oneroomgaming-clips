import { ClipMetadataPanel } from "@/components/clip-metadata";
import { ClipPlayer } from "@/components/clip-player";
import { CommentForm } from "@/components/comment-form";
import { CommentList } from "@/components/comment-list";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/db/client";
import { getClip } from "@/db/clips";
import { listComments } from "@/db/comments";
import { getClipMetadata } from "@/db/metadata";
import { listUsernames } from "@/db/users";
import { clipPublicPath } from "@/lib/media/paths";
import { formatDuration } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ClipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
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
      <ClipPlayer src={clipPublicPath(clip.id)} />

      <div className="mt-4">
        <ClipMetadataPanel
          clipId={clip.id}
          metadata={getClipMetadata(getDb(), clip.id)}
          knownUsers={listUsernames(getDb())}
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Comments</h2>
        <CommentForm clipId={clip.id} />
        <div className="mt-4">
          <CommentList
            clipId={clip.id}
            initial={listComments(getDb(), clip.id)}
            me={user.authentikUsername}
          />
        </div>
      </section>
    </main>
  );
}
