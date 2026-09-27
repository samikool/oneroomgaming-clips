"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { useProfile } from "./profiles-provider";
import { profileHref } from "@/lib/profiles/href";
import { summarizePresence, type OnlinePerson } from "@/lib/presence/summary";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useDismiss } from "@/lib/ui/use-dismiss";

/**
 * "N online" in the header, counting everyone but you. With people around it
 * opens a list of who, and who's in the theater; alone it just says 0.
 */
export function OnlinePill({ me }: { me: string }) {
  const [online, setOnline] = useState<string[]>([me]);
  const [inRoom, setInRoom] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useRealtime(["grid"], (message) => {
    if (message.t === "presence") {
      setOnline(message.online);
      setInRoom(message.inRoom);
    }
  });

  useDismiss(open, wrap, close);

  const { count, others } = summarizePresence(online, inRoom, me);
  const label = `${count} online`;

  if (count === 0) {
    return (
      <span className="online-pill online-pill-alone" title="Nobody else is here right now">
        <span className="online-dot" aria-hidden="true" />
        {label}
      </span>
    );
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        className={`online-pill${open ? " online-pill-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="online-dot online-dot-live" aria-hidden="true" />
        {label}
        <span aria-hidden="true" className="header-caret">▾</span>
      </button>
      {open && (
        <div className="header-popover" role="dialog" aria-label="Who's online">
          <ul className="flex flex-col gap-1">
            {others.map((person) => (
              <OnlineRow key={person.username} person={person} onPick={close} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OnlineRow({ person, onPick }: { person: OnlinePerson; onPick(): void }) {
  const profile = useProfile(person.username);

  return (
    <li>
      <Link href={profileHref(person.username)} className="header-menu-item" onClick={onPick}>
        <Avatar username={person.username} size={24} />
        <span className="min-w-0 flex-1 truncate">{profile.name}</span>
        {person.inTheater && (
          <span title="In the theater" aria-label="in the theater">
            🎬
          </span>
        )}
      </Link>
    </li>
  );
}
