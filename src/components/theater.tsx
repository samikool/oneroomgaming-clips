"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { clipPublicPath } from "@/lib/media/paths";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { createSyncController, type SyncController } from "@/lib/theater/sync-controller";
import { useRoom } from "@/lib/theater/use-room";
import { TheaterTransport } from "./theater-transport";
import { ReactionBar } from "./reaction-bar";
import { ReactionStream } from "./reaction-stream";
import { TheaterChat } from "./theater-chat";
import { WatchingList } from "./watching-list";

type Tab = "chat" | "watching";

const RESYNC_TOAST_MS = 2_500;

export function Theater({ me, clips }: { me: string; clips: ClipSummary[] }) {
  const { view, chat, reactions, clock, send, dismiss } = useRoom();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<SyncController | null>(null);
  const [tab, setTab] = useState<Tab>("watching");
  const [needsGesture, setNeedsGesture] = useState(false);
  const [resynced, setResynced] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);

  const { state } = view;
  const joined = view.inRoom.includes(me);
  const iAmHost = state.hostUserId === me;

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

  return (
    <main className="mx-auto max-w-7xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-ink-muted hover:text-ink">
            ← back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Theater</h1>
        </div>
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

      <div className="flex flex-col gap-6 lg:flex-row">
        <div
          ref={stageRef}
          className={`theater-stage min-w-0 flex-1 ${isFullscreen ? "theater-stage-full" : ""}`}
        >
          {state.clipId === null ? (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-black/40">
              <p className="text-sm text-ink-muted">Nothing is playing.</p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full rounded-lg bg-black"
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
              <ReactionBar onReact={react} />
              <button
                type="button"
                className="button-secondary mt-2"
                onClick={() => void toggleFullscreen()}
              >
                {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </button>
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

          {iAmHost && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-ink">Play something</h2>
              {clips.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Nothing is ready to play yet.{" "}
                  <Link href="/upload" className="underline hover:text-ink">
                    Upload a clip
                  </Link>
                  .
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {clips.map((clip) => (
                    <li key={clip.id}>
                      <button
                        type="button"
                        className="chip-button"
                        onClick={() =>
                          send({
                            t: "room.control",
                            action: "setClip",
                            clipId: clip.id,
                            title: clip.title,
                            durationMs: clip.durationMs,
                          })
                        }
                      >
                        {clip.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isFullscreen && (
            <div className={`theater-overlay ${overlayVisible ? "" : "theater-overlay-hidden"}`}>
              <div className="theater-overlay-panel">
                <WatchingList
                  inRoom={view.inRoom}
                  hostUserId={state.hostUserId}
                  me={me}
                  onGiveControl={(user) => send({ t: "room.giveControl", userId: user })}
                  onClaimHost={() => send({ t: "room.claimHost" })}
                />
                <TheaterChat messages={chat} me={me} onSend={sendChat} compact />
              </div>
            </div>
          )}
        </div>

        <aside className="w-full shrink-0 rounded-lg bg-surface-raised lg:w-80">
          <div className="flex border-b border-[#303b48]">
            <button
              type="button"
              className={`theater-tab ${tab === "chat" ? "theater-tab-active" : ""}`}
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
            <button
              type="button"
              className={`theater-tab ${tab === "watching" ? "theater-tab-active" : ""}`}
              onClick={() => setTab("watching")}
            >
              Watching ({view.inRoom.length})
            </button>
          </div>
          {tab === "chat" ? (
            <TheaterChat messages={chat} me={me} onSend={sendChat} />
          ) : (
            <WatchingList
              inRoom={view.inRoom}
              hostUserId={state.hostUserId}
              me={me}
              onGiveControl={(user) => send({ t: "room.giveControl", userId: user })}
              onClaimHost={() => send({ t: "room.claimHost" })}
            />
          )}
        </aside>
      </div>

      {iAmHost && view.requests.length > 0 && (
        <div className="theater-requests" role="status">
          {view.requests.map((request) => (
            <div key={request.user} className="theater-request">
              <span className="text-sm text-ink">{request.user} wants control</span>
              <button
                type="button"
                className="chip-button"
                onClick={() => {
                  send({ t: "room.giveControl", userId: request.user });
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
