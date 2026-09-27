"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { InstallButton } from "./install-button";
import { Avatar } from "./avatar";
import { useProfile } from "./profiles-provider";
import { SIGN_OUT_PATH } from "./sign-out";
import { ACCENTS } from "@/lib/profiles/palette";
import { profileHref } from "@/lib/profiles/href";
import { useDismiss } from "@/lib/ui/use-dismiss";

/**
 * You, as one button: your picture opens a menu with your profile, the admin
 * page (admins only) and sign-out, instead of each sitting loose in the header.
 */
export function AccountMenu({
  me,
  isAdmin,
  showSignOut,
}: {
  me: string;
  isAdmin: boolean;
  showSignOut: boolean;
}) {
  const profile = useProfile(me);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismiss(open, wrap, close);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        className={`account-button${open ? " account-button-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${profile.name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar username={me} size={28} />
        <span aria-hidden="true" className="header-caret">▾</span>
      </button>
      {open && (
        <div className="header-popover header-popover-right" role="menu" aria-label="Account">
          <div className="account-head">
            <span className="truncate" style={{ color: ACCENTS[profile.accent] }}>
              {profile.name}
            </span>
            <span className="truncate text-xs text-ink-muted">@{me}</span>
          </div>
          <Link href={profileHref(me)} role="menuitem" className="header-menu-item" onClick={close}>
            Your profile
          </Link>
          {isAdmin && (
            <Link href="/admin" role="menuitem" className="header-menu-item" onClick={close}>
              Admin
            </Link>
          )}
          <InstallButton menuItem />
          {showSignOut && (
            <>
              <hr className="header-menu-rule" />
              {/* A plain <a>: signing out is a full navigation out of the app. */}
              <a href={SIGN_OUT_PATH} role="menuitem" className="header-menu-item">
                Sign out
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
