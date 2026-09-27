"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock, shareUrl } from "@/lib/share/timestamp";
import { useClipPlayhead } from "./clip-playhead";

/**
 * Share under the player: the clip's link, optionally starting where the
 * playhead is, with Copy. Built from this page's origin, so staging links
 * point at staging.
 */
export function ShareButton({ clipId }: { clipId: string }) {
  const { currentMs } = useClipPlayhead();
  const [open, setOpen] = useState(false);
  const [startSec, setStartSec] = useState(0);
  const [withStart, setWithStart] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [origin, setOrigin] = useState("");
  const wrapper = useRef<HTMLSpanElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const link = shareUrl(origin, clipId, withStart ? startSec : null);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }

    // The playhead as the popover opens; ticked when it's past the start.
    const seconds = Math.floor(currentMs() / 1000);
    setStartSec(seconds);
    setWithStart(seconds >= 1);
    setStatus("idle");
    setOrigin(window.location.origin);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link);
      setStatus("copied");
    } catch {
      // Plain http or a refused permission: leave it selected to copy by hand.
      input.current?.select();
      setStatus("manual");
    }
  }

  return (
    <span ref={wrapper} className="share">
      <button type="button" className="share-toggle" aria-expanded={open} onClick={toggle}>
        Share
      </button>
      {open && (
        <div className="share-popover" role="dialog" aria-label="Share this clip">
          <div className="share-row">
            <input
              ref={input}
              className="share-link"
              readOnly
              value={link}
              aria-label="Link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="button-primary share-copy" onClick={copy}>
              Copy
            </button>
          </div>
          {startSec >= 1 && (
            <label className="share-start">
              <input type="checkbox" checked={withStart} onChange={(event) => setWithStart(event.target.checked)} />
              Start at {formatClock(startSec * 1000)}
            </label>
          )}
          <p className="share-status" aria-live="polite">
            {status === "copied" ? "Copied." : status === "manual" ? "Press Ctrl+C to copy." : ""}
          </p>
        </div>
      )}
    </span>
  );
}
