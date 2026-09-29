"use client";

import Link from "next/link";
import type { BatchItem } from "@/lib/uploads/batch";
import * as rules from "@/lib/uploads/batch";
import { useUploads } from "@/lib/uploads/provider";
import { Spinner } from "./spinner";

const CANCELLABLE: readonly BatchItem["phase"][] = ["queued", "starting", "uploading", "paused", "error"];

function mb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function Status({ item }: { item: BatchItem }) {
  const percent = item.size === 0 ? 0 : Math.round((item.sent / item.size) * 100);

  switch (item.phase) {
    case "queued":
      return (
        <span className="upload-status">
          <Spinner label="Waiting" /> Queued
        </span>
      );
    case "starting":
      return (
        <span className="upload-status">
          <Spinner label="Connecting" /> Connecting…
        </span>
      );
    case "uploading":
    case "pausing":
    case "paused":
      return (
        <span className="upload-status upload-status-bar">
          <progress className="upload-progress" max={item.size} value={item.sent} aria-label={`${item.title} progress`} />
          <span className="font-pixel text-[10px] tabular-nums">
            {item.phase === "uploading" ? `${percent}%` : item.phase === "pausing" ? "Pausing…" : "Paused"}
          </span>
        </span>
      );
    case "processing":
      return item.retrying ? (
        <span className="upload-status">
          <Spinner label="Retrying" /> Hit a snag, retrying…
        </span>
      ) : (
        <span className="upload-status">
          <Spinner label="Processing" /> Processing…
        </span>
      );
    case "ready":
      return <span className="upload-status text-accent">Ready</span>;
    case "error":
      return <span className="upload-status text-danger">{item.message ?? "Upload stopped"}</span>;
    case "failed":
      return <span className="upload-status text-danger">Could not process this video</span>;
    case "needs_transcode":
      return <span className="upload-status text-danger">This format needs converting first</span>;
    case "duplicate":
      return <span className="upload-status text-accent">{item.message ?? "Already uploaded"}</span>;
    case "cancelled":
      return <span className="upload-status text-ink-muted">Cancelled</span>;
    default:
      return null;
  }
}

/** The live view of a running batch: on the upload page, and compact in the tray. */
export function UploadList({ compact = false }: { compact?: boolean }) {
  const { batch, retry, cancel } = useUploads();
  const items = batch.items.filter((i) => i.phase !== "staged");

  if (items.length === 0) {
    return null;
  }

  return (
    <ul className={`upload-list${compact ? " upload-list-compact" : ""}`} aria-label="Uploads">
      {items.map((item) => (
        <li key={item.key} className={`upload-item upload-item-${item.phase}`}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink" title={item.name}>
              {item.title}
              {!compact && <span className="ml-2 text-xs text-ink-muted">{mb(item.size)}</span>}
            </p>
            <Status item={item} />
          </div>
          {item.phase === "error" && (
            <button type="button" className="chip-button" onClick={() => retry(item.key)}>
              Retry
            </button>
          )}
          {(item.phase === "ready" || item.phase === "duplicate") && item.clipId && (
            <Link className="chip-button" href={`/clips/${item.clipId}`}>
              Watch
            </Link>
          )}
          {CANCELLABLE.includes(item.phase) && (
            <button
              type="button"
              className="queue-action"
              aria-label={`Cancel ${item.title}`}
              onClick={() => cancel(item.key)}
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Pause all / Resume / Cancel all, for whichever state the batch is in. */
export function BatchControls() {
  const { batch, pauseAll, resumeAll, cancelAll } = useUploads();

  if (!rules.isActive(batch)) {
    return null;
  }

  const hasPaused = batch.paused || batch.items.some((i) => i.phase === "paused");

  return (
    <div className="flex flex-wrap gap-2">
      {hasPaused ? (
        <button type="button" className="button-primary" onClick={resumeAll}>
          Resume
        </button>
      ) : (
        <button type="button" className="button-secondary" onClick={pauseAll}>
          Pause all
        </button>
      )}
      <button type="button" className="button-secondary" onClick={cancelAll}>
        Cancel all
      </button>
    </div>
  );
}
