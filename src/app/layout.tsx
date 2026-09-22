import type { Metadata } from "next";
import "./globals.css";
import { ChangelogModal } from "@/components/changelog-modal";
import { formatEntryDate, getChangelogEntries } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "clips",
  description: "Game clips for one room gaming",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [latest] = getChangelogEntries();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
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
