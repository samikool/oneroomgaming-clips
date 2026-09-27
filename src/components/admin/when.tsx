"use client";

import { formatAgo } from "@/lib/format";

/**
 * "5m ago", with the exact time on hover. Relative on purpose: an absolute
 * time rendered on the server would come out in the server's time zone and
 * then disagree with the browser's on hydration.
 */
export function When({ at }: { at: number | null }) {
  if (at === null) {
    return <span className="text-ink-muted">—</span>;
  }

  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toISOString()} suppressHydrationWarning>
      {formatAgo(at)}
    </time>
  );
}
