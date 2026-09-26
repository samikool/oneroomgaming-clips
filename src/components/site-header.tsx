"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { PresenceBar } from "@/components/presence-bar";
import { SignOut } from "@/components/sign-out";
import { UserName } from "@/components/user-name";
import {
  type BarBox,
  barStyle,
  glideFrames,
  glideStops,
  isActiveNav,
  NAV_LINKS,
  navIndex,
  underlineBox,
} from "@/lib/nav";
import { PANEL_MS, SETTLE, useSlide } from "./page-slide";

export function SiteHeader({ me, showSignOut }: { me: string; showSignOut: boolean }) {
  const pathname = usePathname();
  const slide = useSlide();
  const run = slide?.run ?? null;
  // Mid-slide the underline heads for where the click is going, ahead of the
  // page itself.
  const target = run ? run.to : navIndex(pathname);
  const nav = useRef<HTMLElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const shown = useRef<number | null>(null);
  const glide = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const el = bar.current;
    const from = shown.current;
    shown.current = target;

    if (target === null || !el || from === target) {
      return;
    }

    // A slide passes under every tab it crosses, in step with the strip's
    // panels; anything else is one quick hop.
    const stops = run ? glideStops(run.to - run.direction * (run.cards.length + 1), run.to) : [target];
    const boxes = stops.map((i) => links.current[i]).filter((link) => link !== null).map(underlineBox);
    const end = boxes.at(-1);

    if (!end) {
      return;
    }

    const now = currentBox(el);
    glide.current?.cancel();
    Object.assign(el.style, barStyle(end));
    // The bar has a place now, so the CSS underline that covered the first
    // paint can step aside.
    nav.current?.setAttribute("data-underline", "");

    // First showing (or a page outside the header before) has nowhere to glide from.
    if (from === null || boxes.length !== stops.length || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    glide.current = el.animate(glideFrames([now, ...boxes], SETTLE), { duration: stops.length * PANEL_MS });

    if (run) {
      // Catch up to a strip that started a frame or two ago, so both land together.
      glide.current.currentTime = performance.now() - run.startedAt;
    }
  }, [target, run]);

  // Links move when the nav reflows (a resize, a wrap, fonts arriving); follow
  // them straight away rather than gliding.
  useEffect(() => {
    const el = nav.current;

    if (!el) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const link = shown.current === null ? null : links.current[shown.current];

      if (link && bar.current) {
        glide.current?.cancel();
        Object.assign(bar.current.style, barStyle(underlineBox(link)));
      }
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <header className="site-header">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 sm:px-8">
        <Link href="/" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark.png" alt="One Room Gaming" className="h-6 w-auto sm:h-7" />
        </Link>
        {/* Wraps to its own row on a phone rather than hiding behind a menu:
            there are only four links. */}
        <nav ref={nav} aria-label="Main" className="relative flex flex-wrap gap-x-4">
          {NAV_LINKS.map(({ href, label }, i) => {
            const active = isActiveNav(pathname, href);

            return (
              <Link
                key={href}
                ref={(node) => {
                  links.current[i] = node;
                }}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`nav-link${active ? " nav-link-active" : ""}`}
                onClick={(event) => {
                  // A new tab or window is not this page moving; no slide.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                    return;
                  }

                  slide?.start(href);
                }}
              >
                {label}
              </Link>
            );
          })}
          {target !== null && <span ref={bar} className="nav-underline" aria-hidden="true" />}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3 text-sm text-ink-muted">
          <PresenceBar me={me} />
          <UserName username={me} />
          {showSignOut && <SignOut />}
        </div>
      </div>
    </header>
  );
}

/** Where the bar is this instant, part way through a glide or not. */
function currentBox(el: HTMLElement): BarBox {
  const style = getComputedStyle(el);
  const matrix = new DOMMatrixReadOnly(style.transform);

  return { x: matrix.m41, y: matrix.m42, width: parseFloat(style.width) };
}
