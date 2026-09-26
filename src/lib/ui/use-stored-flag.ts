"use client";

import { useEffect, useState } from "react";

/**
 * A per-viewer boolean remembered in this browser. Starts from `initial` so the
 * server render and the first client render agree, then picks up the stored
 * value. Storage can be missing or throw (private windows, blocked site data),
 * in which case the flag simply is not remembered.
 */
export function useStoredFlag(key: string, initial: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);

      if (stored !== null) {
        setValue(stored === "1");
      }
    } catch {
      // Not remembered; the default stands.
    }
  }, [key]);

  function set(next: boolean): void {
    setValue(next);

    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // Not remembered; it still applies for this visit.
    }
  }

  return [value, set];
}
