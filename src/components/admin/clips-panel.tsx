"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { deleteClips } from "@/app/actions";
import { clipEditDataAction, reprocessClipAction, updateClipAction } from "@/app/admin/actions";
import type { AdminClip } from "@/db/admin/clips";
import type { ClipMetadata } from "@/db/metadata";
import { isAllSelected, pruneSelection, selectAll, toggleSelection } from "@/lib/clips/selection";
import { formatBytes } from "@/lib/format";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { UserName } from "../user-name";
import { When } from "./when";

const STATUSES = ["pending", "processing", "retrying", "ready", "needs_transcode", "failed"] as const;

function href(params: { q?: string; status?: string; page?: number }): string {
  const search = new URLSearchParams({ s: "clips" });
  if (params.q) search.set("q", params.q);
  if (params.status) search.set("status", params.status);
  if (params.page) search.set("page", String(params.page));
  return `/admin?${search}`;
}

/**
 * Every clip in a table: search and status filter, select-and-delete, an
 * inline editor per row, and Reprocess for the ones that failed.
 */
export function ClipsPanel({
  rows: initialRows,
  total,
  page,
  pageSize,
  q,
  status,
}: {
  rows: AdminClip[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setRows(initialRows), [initialRows]);

  // Live: a status that moves on (processing → ready) or a clip deleted
  // elsewhere shows here without a reload.
  useRealtime(["grid"], (message) => {
    if (message.t === "clip.updated") {
      const { clip } = message;
      setRows((current) =>
        current.map((row) =>
          row.id === clip.id ? { ...row, title: clip.title, status: clip.status as AdminClip["status"], thumbPath: clip.thumbPath } : row,
        ),
      );
    } else if (message.t === "clip.removed") {
      setRows((current) => current.filter((row) => row.id !== message.clipId));
    }
  });

  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  useEffect(() => setSelected((current) => pruneSelection(current, ids)), [ids]);
  const allSelected = isAllSelected(selected, ids);

  function confirmDelete() {
    const doomed = [...selected];
    startTransition(async () => {
      await deleteClips(doomed);
      setSelected(new Set());
      setConfirming(false);
      router.refresh();
    });
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <form
        className="admin-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          router.push(href({ q: String(form.get("q") ?? "").trim(), status: String(form.get("status") ?? "") }));
        }}
      >
        <input name="q" defaultValue={q} placeholder="Search clips" className="admin-input min-w-0 flex-1" aria-label="Search clips" />
        <select name="status" defaultValue={status} className="admin-input" aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <button type="submit" className="admin-small-button">
          Filter
        </button>
        <span className="ml-auto text-xs text-ink-muted">
          <span className="font-pixel text-accent">{total}</span> clip{total === 1 ? "" : "s"}
        </span>
      </form>

      {selected.size > 0 && (
        <div className="admin-toolbar admin-card px-3 py-2" role="status">
          {confirming ? (
            <>
              <span className="text-sm">
                Delete {selected.size} clip{selected.size === 1 ? "" : "s"} permanently? This cannot be undone.
              </span>
              <button type="button" className="admin-small-button ml-auto" disabled={pending} onClick={() => setConfirming(false)}>
                Keep them
              </button>
              <button type="button" className="button-danger" disabled={pending} onClick={confirmDelete}>
                {pending ? "Deleting…" : "Delete"}
              </button>
            </>
          ) : (
            <>
              <span className="text-sm">
                <span className="font-pixel text-accent">{selected.size}</span> selected
              </span>
              <button type="button" className="admin-small-button ml-auto" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button type="button" className="admin-small-button admin-small-danger" onClick={() => setConfirming(true)}>
                Delete {selected.size}…
              </button>
            </>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No clips match.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={allSelected ? "Deselect all" : "Select all"}
                    checked={allSelected}
                    onChange={() => {
                      setSelected(allSelected ? new Set() : selectAll(ids));
                      setConfirming(false);
                    }}
                  />
                </th>
                <th />
                <th>Title</th>
                <th>Uploader</th>
                <th>Game</th>
                <th>Status</th>
                <th>Size</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className={`admin-row-click${open === row.id ? " admin-row-open" : ""}`}
                    onClick={() => setOpen(open === row.id ? null : row.id)}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.title}`}
                        checked={selected.has(row.id)}
                        onChange={() => {
                          setSelected((current) => toggleSelection(current, row.id));
                          // A confirmation on screen would otherwise say "Delete 2" and delete 3.
                          setConfirming(false);
                        }}
                      />
                    </td>
                    <td>
                      {row.thumbPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.thumbPath} alt="" className="admin-thumb" loading="lazy" />
                      ) : (
                        <span className="admin-thumb" />
                      )}
                    </td>
                    <td className="max-w-[18rem]">
                      <span className="block truncate text-ink">{row.title}</span>
                      {row.errorMessage && <span className="admin-error block">{row.errorMessage}</span>}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      {row.uploader ? <UserName username={row.uploader} variant="compact" /> : <span className="text-ink-muted">—</span>}
                    </td>
                    <td>{row.game ?? <span className="text-ink-muted">—</span>}</td>
                    <td>
                      <span className={`admin-status admin-status-${row.status}`}>{row.status.replace("_", " ")}</span>
                    </td>
                    <td className="whitespace-nowrap">{row.sizeBytes === null ? "—" : formatBytes(row.sizeBytes)}</td>
                    <td className="whitespace-nowrap">
                      <When at={row.createdAt} />
                    </td>
                  </tr>
                  {open === row.id && (
                    <tr>
                      <td colSpan={8}>
                        <ClipEditor row={row} onSaved={() => router.refresh()} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pages">
          {page > 0 ? <Link href={href({ q, status, page: page - 1 })} className="admin-small-button">← Newer</Link> : null}
          <span className="text-ink-muted">
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? <Link href={href({ q, status, page: page + 1 })} className="admin-small-button">Older →</Link> : null}
        </nav>
      )}
    </div>
  );
}

function ClipEditor({ row, onSaved }: { row: AdminClip; onSaved(): void }) {
  const [data, setData] = useState<{ metadata: ClipMetadata; knownUsers: string[] } | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void clipEditDataAction(row.id).then((result) => live && setData(result));
    return () => {
      live = false;
    };
  }, [row.id]);

  function reprocess() {
    startTransition(async () => {
      const result = await reprocessClipAction(row.id);
      setMessage(result.ok ? "Queued from the probe step." : result.error);
      if (result.ok) onSaved();
    });
  }

  // needs_transcode would only land there again: transcoding isn't built yet.
  const canReprocess = row.status === "failed";

  return (
    <div>
      {canReprocess && (
        <div className="admin-toolbar pt-2">
          <button type="button" className="admin-small-button" disabled={pending} onClick={reprocess}>
            Reprocess
          </button>
          <span className="text-xs text-ink-muted">Runs the pipeline again from the probe step.</span>
        </div>
      )}
      {data === undefined ? (
        <p className="py-3 text-sm text-ink-muted">Loading…</p>
      ) : data === null ? (
        <p className="py-3 text-sm text-ink-muted">This clip is gone.</p>
      ) : (
        <form
          className="admin-editor"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const fields = Object.fromEntries(["title", "game", "tags", "participants"].map((k) => [k, String(form.get(k) ?? "")]));
            startTransition(async () => {
              const result = await updateClipAction(row.id, fields);
              setMessage(result.ok ? "Saved." : result.error);
              if (result.ok) onSaved();
            });
          }}
        >
          <label className="admin-field">
            <span>Title</span>
            <input name="title" className="admin-input" defaultValue={row.title} maxLength={200} required />
          </label>
          <label className="admin-field">
            <span>Game</span>
            <input name="game" className="admin-input" defaultValue={data.metadata.game?.name ?? ""} placeholder="Valorant" />
          </label>
          <label className="admin-field">
            <span>Tags, comma separated</span>
            <input name="tags" className="admin-input" defaultValue={data.metadata.tags.join(", ")} placeholder="ace, clutch" />
          </label>
          <label className="admin-field">
            <span>Who is in it — {data.knownUsers.join(", ")}</span>
            <input name="participants" className="admin-input" defaultValue={data.metadata.participants.join(", ")} placeholder="sam, dave" />
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" className="admin-small-button" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            {row.status === "ready" && (
              <Link href={`/clips/${row.id}`} className="text-xs text-ink-muted underline">
                Open clip
              </Link>
            )}
          </div>
        </form>
      )}
      {message && <p className="admin-message pb-2">{message}</p>}
    </div>
  );
}
