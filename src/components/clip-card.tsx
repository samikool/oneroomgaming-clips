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

export type ClipCardSelection = {
  /** Whether the grid is in selection mode at all. */
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
};

export function ClipCard({
  clip,
  selectable = false,
  selected = false,
  onToggle,
}: { clip: ClipCardData } & ClipCardSelection) {
  const label = statusLabel(clip.status);

  const tile = (
    <div className="clip-tile">
      <div className="relative flex aspect-video items-center justify-center bg-surface-sunken">
        {clip.thumbPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.thumbPath} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm text-ink-muted">{label ?? "No preview"}</span>
        )}
        {clip.status === "ready" && (
          <span className="absolute bottom-1 right-1 rounded-sm bg-surface-sunken/80 px-1 font-pixel text-[10px] text-ink">
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
    <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
      {clip.uploader && (
        <Link className="meta-chip" href={withFilter({}, "uploader", clip.uploader)}>
          {clip.uploader}
        </Link>
      )}
      {clip.game && (
        <Link className="meta-chip" href={withFilter({}, "game", clip.game.slug)}>
          {clip.game.name}
        </Link>
      )}
    </p>
  );

  // In selection mode the tile is a <button>, not a <Link> with the navigation
  // cancelled. An anchor that sometimes navigates and sometimes does not is
  // the version that breaks middle-click, keyboard and "open in new tab".
  if (selectable) {
    return (
      <div>
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onToggle?.(clip.id)}
          className={`relative block w-full cursor-pointer text-left${selected ? " clip-selected" : ""}`}
        >
          <span
            aria-hidden="true"
            className={`clip-check${selected ? " clip-check-on" : ""}`}
          />
          <span className={clip.status === "ready" ? undefined : "block opacity-60"}>
            {tile}
          </span>
          <span className="sr-only">{selected ? "Selected" : "Not selected"}</span>
        </button>
        {/* The footer's filter links are dropped while selecting: following one
            navigates away and silently discards the selection. */}
      </div>
    );
  }

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
