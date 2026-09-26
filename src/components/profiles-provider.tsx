"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { applyProfileUpdate, directoryFrom, standInProfile, type Directory } from "@/lib/profiles/store";
import type { Profile } from "@/lib/profiles/types";
import { useRealtime } from "@/lib/realtime/use-realtime";

const ProfilesContext = createContext<Directory>({});
const ApplyProfileContext = createContext<(profile: Profile) => void>(() => {});

/**
 * Everyone's profile, shipped with the page and kept live. A group this size
 * fits in one small map, which is what lets a rename show up everywhere at
 * once.
 */
export function ProfilesProvider({ initial, children }: { initial: Profile[]; children: React.ReactNode }) {
  const [directory, setDirectory] = useState(() => directoryFrom(initial));
  const apply = useCallback(
    (profile: Profile) => setDirectory((current) => applyProfileUpdate(current, profile)),
    [],
  );

  useRealtime(["profiles"], (message) => {
    if (message.t === "profile.updated") {
      apply(message.profile);
    }
  });

  return (
    <ApplyProfileContext.Provider value={apply}>
      <ProfilesContext.Provider value={directory}>{children}</ProfilesContext.Provider>
    </ApplyProfileContext.Provider>
  );
}

export function useProfile(username: string): Profile {
  return useContext(ProfilesContext)[username] ?? standInProfile(username);
}

/**
 * Puts a profile the server just returned into this tab's directory. The
 * broadcast would bring it too, but not when realtime is down, and the person
 * who pressed Save should never be the one left looking at the old version.
 */
export function useApplyProfile(): (profile: Profile) => void {
  return useContext(ApplyProfileContext);
}

/** Everyone, sorted by name, for pickers and filters. */
export function useDirectory(): Profile[] {
  const directory = useContext(ProfilesContext);
  return useMemo(
    () => Object.values(directory).sort((a, b) => a.name.localeCompare(b.name)),
    [directory],
  );
}
