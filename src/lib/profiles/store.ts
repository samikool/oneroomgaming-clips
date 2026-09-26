import { defaultAccent } from "./palette";
import type { Profile } from "./types";

export type Directory = Record<string, Profile>;

export function directoryFrom(profiles: Profile[]): Directory {
  return Object.fromEntries(profiles.map((profile) => [profile.username, profile]));
}

function sameProfile(a: Profile, b: Profile): boolean {
  return (
    a.userId === b.userId &&
    a.name === b.name &&
    a.accent === b.accent &&
    a.bio === b.bio &&
    a.pictureVersion === b.pictureVersion
  );
}

/**
 * The directory after `profile` arrives. An update that changes nothing (a
 * repeat of what the page already has) returns the same object, so nothing
 * that reads the directory re-renders.
 */
export function applyProfileUpdate(directory: Directory, profile: Profile): Directory {
  const current = directory[profile.username];

  if (current && sameProfile(current, profile)) {
    return directory;
  }

  return { ...directory, [profile.username]: profile };
}

/** Someone the page has not heard of yet: shown by username until their profile arrives. */
export function standInProfile(username: string): Profile {
  return { username, userId: "", name: username, accent: defaultAccent(username), bio: null, pictureVersion: null };
}
