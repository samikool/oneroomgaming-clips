"use client";

import { useProfile } from "./profiles-provider";
import { ACCENTS } from "@/lib/profiles/palette";
import { picturePath } from "@/lib/profiles/picture-path";
import { initialOf } from "@/lib/profiles/href";

/** A round picture, or the person's initial on their accent colour. */
export function Avatar({ username, size = 24 }: { username: string; size?: number }) {
  const profile = useProfile(username);
  const src = picturePath(profile, size > 64 ? 256 : 64);
  const style = { width: size, height: size };

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={profile.name} className="avatar" style={style} width={size} height={size} loading="lazy" />;
  }

  return (
    <span
      className="avatar avatar-initial font-pixel"
      style={{ ...style, background: ACCENTS[profile.accent], fontSize: Math.round(size * 0.5) }}
      role="img"
      aria-label={profile.name}
    >
      {initialOf(profile.name)}
    </span>
  );
}
