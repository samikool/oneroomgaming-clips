"use client";

import Link from "next/link";
import { Avatar } from "./avatar";
import { useProfile } from "./profiles-provider";
import { ACCENTS } from "@/lib/profiles/palette";
import { profileHref } from "@/lib/profiles/href";

/**
 * A person, the same way everywhere: their name in their colour, and — where
 * there is room — their picture and the @username that never changes.
 */
export function UserName({
  username,
  variant = "full",
  withAvatar = variant === "full",
  link = true,
}: {
  username: string;
  variant?: "full" | "compact";
  withAvatar?: boolean;
  link?: boolean;
}) {
  const profile = useProfile(username);
  const body = (
    <>
      {withAvatar && <Avatar username={username} size={variant === "full" ? 24 : 16} />}
      <span className="user-name-text" style={{ color: ACCENTS[profile.accent] }}>
        {profile.name}
      </span>
      {variant === "full" && profile.name !== username && <span className="user-name-handle">@{username}</span>}
    </>
  );

  return link ? (
    <Link href={profileHref(username)} className="user-name">
      {body}
    </Link>
  ) : (
    <span className="user-name">{body}</span>
  );
}
