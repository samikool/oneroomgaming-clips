"use client";

import { useState } from "react";
import { Avatar } from "./avatar";
import { ProfileEditor } from "./profile-editor";
import { useProfile } from "./profiles-provider";
import { ACCENTS } from "@/lib/profiles/palette";

/**
 * The top of someone's page. Reads the live directory, so a rename or a new
 * picture shows here the moment it is saved, by whoever is looking. On your
 * own page, Edit profile turns it into the form.
 */
export function ProfileHeader({ username, isMe }: { username: string; isMe: boolean }) {
  const profile = useProfile(username);
  const [editing, setEditing] = useState(false);
  const accent = ACCENTS[profile.accent];

  return (
    <header className="profile-header" style={{ borderBottomColor: accent }}>
      {isMe && editing ? (
        <ProfileEditor username={username} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-5">
          <Avatar username={username} size={96} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-3xl" style={{ color: accent }}>
              {profile.name}
            </h1>
            <p className="text-sm text-ink-muted">@{username}</p>
            {profile.bio && <p className="mt-2 whitespace-pre-line text-sm text-ink">{profile.bio}</p>}
          </div>
          {isMe && (
            <button type="button" className="button-secondary shrink-0" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          )}
        </div>
      )}
    </header>
  );
}
