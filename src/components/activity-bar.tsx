"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";
import { positionNow } from "@/lib/realtime/room-state";
import { useRoom } from "@/lib/theater/use-room";
import { summarize } from "@/lib/uploads/batch";
import { useUploads } from "@/lib/uploads/provider";
import { Spinner } from "./spinner";
import { UserName } from "./user-name";
import { BatchControls, UploadList } from "./upload-list";

type Tray = "theater" | "uploads" | null;

/**
 * Pinned to the bottom of every page: one pill per thing going on — the
 * theater, and uploads while a batch exists. A pill opens a tray above the bar
 * with that thing's controls, so nothing needs its own page to be managed.
 */
export function ActivityBar({ me }: { me: string }) {
  const [tray, setTray] = useState<Tray>(null);
  const { batch, clearFinished } = useUploads();
  const summary = summarize(batch);
  const hasUploads = summary.total > 0;

  // Escape closes whichever tray is open.
  useEffect(() => {
    if (!tray) {
      return;
    }

    const onKey = (event: KeyboardEvent) => event.key === "Escape" && closeTray();
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  });

  function closeTray(): void {
    // A finished batch leaves the bar once you have looked at it.
    if (tray === "uploads" && summary.finished) {
      clearFinished();
    }

    setTray(null);
  }

  function toggle(next: Exclude<Tray, null>): void {
    if (tray === next) {
      closeTray();
    } else {
      setTray(next);
    }
  }

  return (
    <>
      {tray === "theater" && <TheaterTray me={me} onClose={closeTray} />}
      {tray === "uploads" && hasUploads && (
        <div className="tray tray-right" role="dialog" aria-label="Uploads">
          <div className="tray-head">
            <h2 className="text-sm">Uploads</h2>
            <button type="button" className="dock-dismiss" aria-label="Close uploads" onClick={closeTray}>
              ×
            </button>
          </div>
          <div className="tray-body">
            <UploadList compact />
          </div>
          <div className="tray-foot">
            <BatchControls />
          </div>
        </div>
      )}

      <div className="activity-bar">
        <TheaterPill me={me} open={tray === "theater"} onToggle={() => toggle("theater")} />
        {hasUploads && (
          <button
            type="button"
            className={`pill ml-auto${tray === "uploads" ? " pill-open" : ""}${summary.finished ? " pill-done" : ""}`}
            aria-expanded={tray === "uploads"}
            onClick={() => toggle("uploads")}
          >
            {summary.finished ? (
              <>✓ {summary.total} uploaded</>
            ) : summary.uploaded === summary.total ? (
              <>
                <Spinner label="Processing" /> Processing {summary.processing}…
              </>
            ) : (
              <>
                <span aria-hidden="true">⬆</span> Uploading {Math.min(summary.uploaded + 1, summary.total)} of{" "}
                {summary.total} · <span className="font-pixel text-[10px]">{summary.percent}%</span>
              </>
            )}
          </button>
        )}
      </div>
    </>
  );
}

function useTicking(active: boolean): void {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setInterval(() => tick((n) => n + 1), 1_000);

    return () => clearInterval(timer);
  }, [active]);
}

function TheaterPill({ me, open, onToggle }: { me: string; open: boolean; onToggle(): void }) {
  const { view } = useRoom();
  const { state } = view;
  const joined = view.inRoom.includes(me);

  const label =
    state.clipId === null && view.inRoom.length === 0
      ? "Theater · empty"
      : `${state.clipTitle ?? "Theater"} · ${view.inRoom.length} watching`;

  return (
    <button
      type="button"
      className={`pill min-w-0${open ? " pill-open" : ""}${joined ? " pill-live" : ""}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span aria-hidden="true">▶</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function TheaterTray({ me, onClose }: { me: string; onClose(): void }) {
  const { view, clock, send } = useRoom();
  const { state } = view;
  const joined = view.inRoom.includes(me);
  useTicking(!state.paused && state.clipId !== null);

  const host = state.hostUserId ?? "nobody";

  return (
    <div className="tray tray-left" role="dialog" aria-label="Theater">
      <div className="tray-head">
        <h2 className="text-sm">Theater</h2>
        <button type="button" className="dock-dismiss" aria-label="Close theater" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="tray-body flex flex-col gap-1 p-3">
        <p className="truncate text-sm text-ink">{state.clipTitle ?? "Nothing playing"}</p>
        <p className="text-xs text-ink-muted">
          {state.hostUserId === me
            ? "You have control"
            : state.hostUserId === null
              ? "Nobody has control"
              : <><UserName username={host} variant="compact" link={false} /> is hosting</>}{" "}
          · {view.inRoom.length} watching
          {state.clipId !== null &&
            ` · ${formatDuration(positionNow(state, clock.now(Date.now())))} / ${formatDuration(state.clipDurationMs)}`}
        </p>
      </div>
      <div className="tray-foot flex gap-2">
        <Link href="/theater" className="button-primary" onClick={onClose}>
          Open theater
        </Link>
        {joined ? (
          <button type="button" className="button-secondary" onClick={() => send({ t: "room.leave" })}>
            Leave
          </button>
        ) : (
          <button type="button" className="button-secondary" onClick={() => send({ t: "room.join" })}>
            Join here
          </button>
        )}
      </div>
    </div>
  );
}
