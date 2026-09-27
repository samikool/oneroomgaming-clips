import type { Metadata } from "next";
import "./globals.css";
import { display, pixel } from "./fonts";
import { AppShell } from "@/components/app-shell";
import { ChangelogModal } from "@/components/changelog-modal";
import { SwRegister } from "@/components/sw-register";
import { getDb } from "@/db/client";
import { listProfiles } from "@/db/profiles";
import { isAdmin } from "@/lib/auth";
import { EARLY_PROMPT_SCRIPT } from "@/lib/pwa/install";
import { formatEntryDate, getChangelogEntries } from "@/lib/changelog";
import { requireUser, signedInViaDevFallback } from "@/lib/session";

export const metadata: Metadata = {
  title: "clips",
  description: "Game clips for one room gaming",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [latest] = getChangelogEntries();
  const user = await requireUser();
  // After requireUser, so a first-time visitor is already in their own directory.
  const profiles = listProfiles(getDb());
  // The dev fallback has no Authentik session to end.
  const showSignOut = !(await signedInViaDevFallback());

  return (
    <html lang="en" className={`${display.variable} ${pixel.variable}`}>
      <head>
        {/* By hand, not metadata.manifest: the browser fetches a manifest without
            cookies unless told otherwise, and behind forward_auth that fetch
            would get the Authentik login instead. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#1c1f26" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script dangerouslySetInnerHTML={{ __html: EARLY_PROMPT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <AppShell
          me={user.authentikUsername}
          showSignOut={showSignOut}
          isAdmin={isAdmin(user.authentikUsername)}
          profiles={profiles}
        >
          {children}
        </AppShell>
        <SwRegister />
        {latest && (
          <ChangelogModal
            version={latest.version}
            title={latest.title}
            date={formatEntryDate(latest.date.toISOString())}
            html={latest.html}
          />
        )}
      </body>
    </html>
  );
}
