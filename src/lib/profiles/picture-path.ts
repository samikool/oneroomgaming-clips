import type { Profile } from "./types";

// No node imports here: client components render pictures through this file.

export type PictureSize = 64 | 256;

export function pictureFilename(userId: string, version: number, size: PictureSize): string {
  return `${userId}-${version}-${size}.webp`;
}

/** Versioned, so a new picture never hides behind a cached old one. */
export function picturePath(
  profile: Pick<Profile, "userId" | "pictureVersion">,
  size: PictureSize,
): string | null {
  return profile.pictureVersion === null
    ? null
    : `/media/avatars/${pictureFilename(profile.userId, profile.pictureVersion, size)}`;
}
