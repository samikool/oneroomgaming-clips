"use client";

import { useEffect, useState } from "react";
import { readLastSeenVersion, shouldShowChangelog } from "@/lib/changelog-visibility";

const LAST_SEEN_KEY = "clips.changelog.lastSeen";

function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(version: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    // localStorage can throw in some private-browsing modes; a broken
    // changelog must never break the page.
  }
}

export interface ChangelogModalProps {
  version: string;
  title: string;
  date: string;
  html: string;
}

export function ChangelogModal({
  version,
  title,
  date,
  html,
}: ChangelogModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const lastSeen = readLastSeenVersion(readLastSeen);

    if (shouldShowChangelog({ latest: version, lastSeen })) {
      setOpen(true);
      return;
    }

    if (lastSeen === null) {
      // First visit: silently record the current version, no modal.
      writeLastSeen(version);
    }
  }, [version]);

  function dismiss() {
    writeLastSeen(version);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismiss();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={dismiss}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-raised p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Version {version} &middot; {date}
        </p>
        <div
          className="mt-4 space-y-2 text-sm text-ink [&_li]:ml-5 [&_ul]:list-disc"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <button
          type="button"
          onClick={dismiss}
          className="mt-6 rounded-md bg-surface px-4 py-2 text-sm font-medium text-ink hover:opacity-80"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
