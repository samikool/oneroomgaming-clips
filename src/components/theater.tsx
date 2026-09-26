"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clipPublicPath } from "@/lib/media/paths";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { mergeClip, type ClipMap } from "@/lib/realtime/merge";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { createSyncController, type SyncController } from "@/lib/theater/sync-controller";
import { useRoom } from "@/lib/theater/use-room";
import { TheaterTransport } from "./theater-transport";
import { ReactionBar } from "./reaction-bar";
import { ReactionStream } from "./reaction-stream";
import { SidePanel } from "./side-panel";
import { TheaterChat } from "./theater-chat";
import { TheaterGrid } from "./theater-grid";
import { TheaterQueue } from "./theater-queue";
import { WatchingList } from "./watching-list";
import { WatchingStrip } from "./watching-strip";

/** Which side panel a phone shows; on desktop both are always there. */
type Tab = "queue" | "chat";

const RESYNC_TOAST_MS = 2_500;

export function Theater({ me, clips }: { me: string; clips: ClipSummary[] }) {
  const { view, chat, reactions, clock, send, dismiss } = useRoom();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<SyncController | null>(null);
  const [tab, setTab] = useState<Tab>("queue");
  const [clipMap, setClipMap] = useState<ClipMap>(() =>
    Object.fromEntries(clips.map((clip) => [clip.id, clip])),
  );
  const autoJoined = useRef(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [resynced, setResynced] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);

  const { state } = view;
  const joined = view.inRoom.includes(me);
  const iAmHost = state.hostUserId === me;

  // Opening the theater is joining it. Once per visit, on the first presence
  // (the socket's first word after subscribing): a join sent before the socket
  // opens is silently dropped, and joining again after Leave would make Leave
  // impossible.
  useRealtime(["room", "grid"], (message) => {
    if (message.t === "presence" && !autoJoined.current) {
      autoJoined.current = true;

      if (!message.inRoom.includes(me)) {
        send({ t: "room.join" });
      }
    }

    setClipMap((current) => mergeClip(current, message));
  });

  // Only a finished clip can be played in sync, so the grid shows ready clips
  // only — the same rule the page applies to its first render.
  const ready = useMemo(
    () =>
      Object.values(clipMap)
        .filter((clip) => clip.status === "ready")
        .sort((a, b) => b.createdAt - a.createdAt),
    [clipMap],
  );
  const clipsById = useMemo(() => new Map(ready.map((clip) => [clip.id, clip])), [ready]);

  useEffect(() => {
    const controller = createSyncController({
      clock,
      onResync: () => setResynced(true),
      onAutoplayBlocked: () => setNeedsGesture(true),
    });
    controllerRef.current = controller;

    return () => {
      controller.detach();
      controllerRef.current = null;
    };
  }, [clock]);

  // Attach only while joined. Someone browsing the grid should not have their
  // browser quietly seeking a video they never opened.
  useEffect(() => {
    const controller = controllerRef.current;
    const video = videoRef.current;

    if (!controller || !video || !joined || state.clipId === null) {
      return;
    }

    controller.attach(video);

    return () => controller.detach();
  }, [joined, state.clipId]);

  useEffect(() => {
    if (joined) {
      controllerRef.current?.applyRoomState(state);
    }
  }, [joined, state]);

  useEffect(() => {
    if (!resynced) {
      return;
    }

    const timer = setTimeout(() => setResynced(false), RESYNC_TOAST_MS);

    return () => clearTimeout(timer);
  }, [resynced]);

  // Escape exits fullscreen without going through the button, so the event is
  // the only reliable source of truth for this flag.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);

    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // The overlay auto-hides so it does not sit on the gameplay permanently.
  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const show = () => {
      setOverlayVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setOverlayVisible(false), 3_000);
    };

    show();
    const stage = stageRef.current;
    stage?.addEventListener("pointermove", show);

    return () => {
      clearTimeout(timer);
      stage?.removeEventListener("pointermove", show);
    };
  }, [isFullscreen]);

  async function toggleFullscreen(): Promise<void> {
    // The target is the CONTAINER, never the <video>. The Fullscreen API
    // renders only the fullscreened element and its descendants, so
    // fullscreening the video makes an overlay impossible — and that cannot be
    // fixed later without restructuring this component tree.
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageRef.current?.requestFullscreen();
      }
    } catch {
      // Some browsers refuse outside a user gesture or inside an iframe. The
      // page stays usable windowed.
    }
  }

  function sendChat(text: string): void {
    send({ t: "chat.send", text });
  }

  function react(emoji: string): void {
    send({ t: "reaction.send", emoji });
  }

  function tapToSync(): void {
    setNeedsGesture(false);
    // The gesture is the point: this call is inside a click handler, so the
    // autoplay policy allows it where the controller's own call was refused.
    void videoRef.current?.play().catch(() => setNeedsGesture(true));
  }

  const giveControl = (user: string) => send({ t: "room.giveControl", userId: user });
  const claimHost = () => send({ t: "room.claimHost" });

  return (
    <main className="mx-auto max-w-[1600px] px-5 py-6 sm:px-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Theater</h1>
        {joined ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => send({ t: "room.leave" })}
          >
            Leave
          </button>
        ) : (
          <button type="button" className="button-primary" onClick={() => send({ t: "room.join" })}>
            Join
          </button>
        )}
      </div>

      <div className="theater-layout">
        {/* Phones only: the video sits first (CSS order), then these tabs pick
            which panel shows underneath. */}
        <div className="theater-tabs">
          <button
            type="button"
            className={`theater-tab ${tab === "queue" ? "theater-tab-active" : ""}`}
            onClick={() => setTab("queue")}
          >
            Queue ({state.queue.length})
          </button>
          <button
            type="button"
            className={`theater-tab ${tab === "chat" ? "theater-tab-active" : ""}`}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
        </div>

        <SidePanel id="queue" title="Queue" side="left" hiddenOnMobile={tab !== "queue"}>
          <TheaterQueue
            queue={state.queue}
            clipsById={clipsById}
            iAmHost={iAmHost}
            onQueue={send}
          />
        </SidePanel>

        <div
          ref={stageRef}
          className={`theater-stage min-w-0 flex-1 ${isFullscreen ? "theater-stage-full" : ""}`}
        >
          {state.clipId === null ? (
            <div className="flex aspect-video items-center justify-center rounded bg-surface-sunken">
              <p className="text-sm text-ink-muted">
                {state.queue.length > 0 && iAmHost
                  ? "Press Play next to start the queue."
                  : "Nothing is playing."}
              </p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full rounded bg-black"
                src={clipPublicPath(state.clipId)}
                preload="auto"
                playsInline
                // The room's transport is the only transport. Native controls
                // would give the host a second scrubber that disagrees with
                // the room's and sends no room.control.
                controls={false}
              />
              <ReactionStream reactions={reactions} />
              <TheaterTransport
                state={state}
                clock={clock}
                canControl={iAmHost}
                onPlay={() => send({ t: "room.control", action: "play" })}
                onPause={() => send({ t: "room.control", action: "pause" })}
                onSeek={(positionMs) => send({ t: "room.control", action: "seek", positionMs })}
                onRequestControl={() => send({ t: "room.requestControl" })}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ReactionBar onReact={react} />
                <button
                  type="button"
                  className="button-secondary ml-auto"
                  onClick={() => void toggleFullscreen()}
                >
                  {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                </button>
              </div>
              {needsGesture && (
                <button type="button" className="button-primary mt-4" onClick={tapToSync}>
                  Tap to sync
                </button>
              )}
              {resynced && (
                <p role="status" className="mt-2 text-xs text-ink-muted">
                  Resynced — you had fallen behind the room.
                </p>
              )}
            </>
          )}

          {/* Fullscreen has its own overlay for this. */}
          {!isFullscreen && (
            <WatchingStrip
              inRoom={view.inRoom}
              hostUserId={state.hostUserId}
              me={me}
              onGiveControl={giveControl}
              onClaimHost={claimHost}
            />
          )}

          {isFullscreen && (
            <div className={`theater-overlay ${overlayVisible ? "" : "theater-overlay-hidden"}`}>
              <div className="theater-overlay-panel">
                <WatchingList
                  inRoom={view.inRoom}
                  hostUserId={state.hostUserId}
                  me={me}
                  onGiveControl={giveControl}
                  onClaimHost={claimHost}
                />
                <TheaterChat messages={chat} me={me} onSend={sendChat} compact />
              </div>
            </div>
          )}
        </div>

        <SidePanel id="chat" title="Chat" side="right" hiddenOnMobile={tab !== "chat"}>
          <TheaterChat messages={chat} me={me} onSend={sendChat} />
        </SidePanel>
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-xl text-ink">Clips</h2>
        <TheaterGrid
          clips={ready}
          iAmHost={iAmHost}
          queueLength={state.queue.length}
          onQueue={(clip) =>
            send({
              t: "room.queue",
              op: "add",
              clipId: clip.id,
              title: clip.title,
              durationMs: clip.durationMs,
            })
          }
          onPlayNow={(clip) =>
            send({
              t: "room.control",
              action: "setClip",
              clipId: clip.id,
              title: clip.title,
              durationMs: clip.durationMs,
            })
          }
        />
      </section>

      {iAmHost && view.requests.length > 0 && (
        <div className="theater-requests" role="status">
          {view.requests.map((request) => (
            <div key={request.user} className="theater-request">
              <span className="text-sm text-ink">{request.user} wants control</span>
              <button
                type="button"
                className="chip-button"
                onClick={() => {
                  giveControl(request.user);
                  dismiss(request.user);
                }}
              >
                Give control
              </button>
              <button
                type="button"
                className="dock-dismiss"
                aria-label={`Dismiss ${request.user}'s request`}
                onClick={() => dismiss(request.user)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
