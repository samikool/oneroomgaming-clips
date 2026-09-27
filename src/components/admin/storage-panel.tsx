import type { UploaderStorage } from "@/db/admin/storage";
import { formatBytes } from "@/lib/format";
import { UserName } from "../user-name";

/** The library's size, and who it belongs to, as a sorted bar list. */
export function StoragePanel({
  total,
  uploaders,
  avatars,
}: {
  total: number;
  uploaders: UploaderStorage[];
  avatars: number;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-muted">
        <span className="font-pixel text-lg text-ink">{formatBytes(total)}</span> of clips
        <span className="mx-2">·</span>
        {formatBytes(avatars)} of profile pictures
      </p>

      {uploaders.length === 0 ? (
        <p className="text-sm text-ink-muted">No clips yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {uploaders.map((row) => (
            <li key={row.username ?? "(none)"} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">
                  {row.username ? <UserName username={row.username} /> : <span className="text-ink-muted">No uploader</span>}
                </span>
                <span className="shrink-0 text-ink-muted">
                  {row.clips} clip{row.clips === 1 ? "" : "s"} · {formatBytes(row.bytes)} ·{" "}
                  <span className="font-pixel text-[11px] text-ink">{Math.round(row.share * 100)}%</span>
                </span>
              </div>
              <div className="admin-bar-track" aria-hidden="true">
                <div className="admin-bar-fill" style={{ width: `${row.share * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
