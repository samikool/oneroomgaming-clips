"use client";

import { useEffect, useState } from "react";

const KEY = "clips.dock.dismissed";

/**
 * Whether this browser has collapsed the dock.
 *
 * Per-user browser state in localStorage — no schema, nothing to sync. It
 * starts false and is corrected after mount, because reading localStorage
 * during render would mismatch the server-rendered HTML.
 */
export function useDockDismissed(): [boolean, (value: boolean) => void] {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(KEY) === "1");
    } catch {
      // Private mode, or storage disabled. The dock simply stays open.
    }
  }, []);

  function update(value: boolean): void {
    setDismissed(value);

    try {
      localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      // Nothing to do; the choice lasts for this page view.
    }
  }

  return [dismissed, update];
}
