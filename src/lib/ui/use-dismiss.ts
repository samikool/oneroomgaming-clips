"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popover on Escape or a pointer press outside `within` (the
 * popover and the button that opened it). Inactive while `open` is false, so
 * a closed menu costs no listeners.
 */
export function useDismiss(open: boolean, within: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onDown = (event: PointerEvent) => {
      if (!within.current?.contains(event.target as Node)) onClose();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, within, onClose]);
}
