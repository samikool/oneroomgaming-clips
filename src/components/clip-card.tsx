import Link from "next/link";
import { withFilter } from "@/lib/filters";
import type { ClipStatus } from "@/db/schema";
import { formatDuration } from "@/lib/format";

const STATUS_LABEL: Partial<Record<ClipStatus, string>> = {
  pending: "Queued",
  processing: "Processing",
  needs_transcode: "Unsupported format",
  failed: "Failed",
};

/**
 * Exactly what this card reads. A live `ClipSummary` off the wire satisfies it
 * structurally, and so does a full `Clip` row — so the server-rendered path is
 * unchanged and no one has to fake a `Clip` to render a pushed update.
 */
export type ClipCardData = {
  id: string;
  title: string;
  status: string;
  thumbPath: string | null;
  durationMs: number | null;
  uploader?: string | null;
  game?: { name: string; slug: string } | null;
};

// `status` arrives as a plain string over the wire. Narrowing here keeps the
// lookup typed while an unrecognised value simply yields no label.
function statusLabel(status: string): string | undefined {
  return STATUS_LABEL[status as ClipStatus];
}

export function ClipCard({ clip }: { clip: ClipCardData }) {
  const label = statusLabel(clip.status);

  const tile = (
    <div className="overflow-hidden rounded-lg bg-surface-raised">
      <div className="relative flex aspect-video items-center justify-center bg-black/40">
        {clip.thumbPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.thumbPath} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm text-ink-muted">{label ?? "No preview"}</span>
        )}
        {clip.status === "ready" && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-xs text-ink">
            {formatDuration(clip.durationMs)}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="truncate text-sm text-ink">{clip.title}</p>
        {label && <p className="text-xs text-ink-muted">{label}</p>}
      </div>
    </div>
  );

  // The footer sits OUTSIDE the tile's link: the tile is already an anchor,
  // and nesting one inside it is invalid HTML that browsers resolve
  // unpredictably.
  const footer = (clip.uploader || clip.game) && (
    <p className="mt-1 flex flex-wrap gap-2 text-xs text-ink-muted">
      {clip.uploader && (
        <Link className="hover:text-ink" href={withFilter({}, "uploader", clip.uploader)}>
          {clip.uploader}
        </Link>
      )}
      {clip.game && (
        <Link className="hover:text-ink" href={withFilter({}, "game", clip.game.slug)}>
          {clip.game.name}
        </Link>
      )}
    </p>
  );

  if (clip.status !== "ready") {
    return (
      <div>
        <div className="opacity-60">{tile}</div>
        {footer}
      </div>
    );
  }

  return (
    <div>
      <Link href={`/clips/${clip.id}`}>{tile}</Link>
      {footer}
    </div>
  );
}
