"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "./avatar";
import { profileHref } from "@/lib/profiles/href";
import { useRealtime } from "@/lib/realtime/use-realtime";

/**
 * Starts optimistically listing just you, so the bar never flashes empty
 * between the page rendering and the socket's first presence message.
 */
export function PresenceBar({ me }: { me: string }) {
  const [online, setOnline] = useState<string[]>([me]);

  useRealtime(["grid"], (message) => {
    if (message.t === "presence") {
      setOnline(message.online);
    }
  });

  const others = online.filter((name) => name !== me);

  return others.length === 0 ? (
    <span>You&apos;re the only one here</span>
  ) : (
    <span className="inline-flex items-center gap-1">
      Here now:
      {others.map((name) => (
        <Link key={name} href={profileHref(name)} title={name} aria-label={name} className="inline-flex">
          <Avatar username={name} size={20} />
        </Link>
      ))}
    </span>
  );
}
