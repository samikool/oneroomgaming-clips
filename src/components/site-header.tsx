"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PresenceBar } from "@/components/presence-bar";
import { isActiveNav } from "@/lib/nav";

const LINKS = [
  { href: "/", label: "Clips" },
  { href: "/theater", label: "Theater" },
  { href: "/upload", label: "Upload" },
  { href: "/changelog", label: "Changelog" },
];

export function SiteHeader({ me, name }: { me: string; name: string }) {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 sm:px-8">
        <Link href="/" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark.png" alt="One Room Gaming" className="h-6 w-auto sm:h-7" />
        </Link>
        {/* Wraps to its own row on a phone rather than hiding behind a menu:
            there are only four links. */}
        <nav aria-label="Main" className="flex flex-wrap gap-x-4">
          {LINKS.map(({ href, label }) => {
            const active = isActiveNav(pathname, href);

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`nav-link${active ? " nav-link-active" : ""}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <p className="ml-auto min-w-0 text-sm text-ink-muted">
          <span className="text-ink">{name}</span> · <PresenceBar me={me} />
        </p>
      </div>
    </header>
  );
}
