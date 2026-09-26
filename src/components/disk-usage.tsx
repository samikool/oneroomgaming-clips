import { formatBytes } from "@/lib/format";

/**
 * Surfaced because it is useful to know. There are no quotas. Inline, so the
 * caller sets the text style and can share the line with other metadata.
 */
export function DiskUsage({ bytes }: { bytes: number }) {
  return <span>{formatBytes(bytes)} stored</span>;
}
