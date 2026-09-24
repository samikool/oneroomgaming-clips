import { formatBytes } from "@/lib/format";

/** Surfaced because it is useful to know. There are no quotas. */
export function DiskUsage({ bytes }: { bytes: number }) {
  return <p className="text-xs text-ink-muted">{formatBytes(bytes)} stored</p>;
}
