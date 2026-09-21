import type { Metadata } from "next";
import { getChangelogEntries } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog — clips",
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ChangelogPage() {
  const entries = getChangelogEntries();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-ink">Changelog</h1>
      <div className="mt-8 space-y-10">
        {entries.map((entry) => (
          <article key={entry.version}>
            <h2 className="text-lg font-semibold text-ink">{entry.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Version {entry.version} &middot; {formatDate(entry.date)}
            </p>
            <div
              className="mt-3 space-y-2 text-sm text-ink [&_li]:ml-5 [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: entry.html }}
            />
          </article>
        ))}
      </div>
    </main>
  );
}
