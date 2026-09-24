import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ChangelogModal } from "@/components/changelog-modal";
import { formatEntryDate, getChangelogEntries } from "@/lib/changelog";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "clips",
  description: "Game clips for one room gaming",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [latest] = getChangelogEntries();
  const user = await requireUser();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppShell me={user.authentikUsername}>{children}</AppShell>
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
