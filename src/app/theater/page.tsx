import { Theater } from "@/components/theater";
import { getDb } from "@/db/client";
import { listBrowseOptions } from "@/db/browse-options";
import { listReadyThumbs } from "@/db/clips";
import { parseBrowseQuery, SORTS } from "@/lib/browse/query";
import { browseTabs } from "@/lib/browse/tabs";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TheaterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const db = getDb();
  const query = parseBrowseQuery(await searchParams);
  // Only a finished clip can be played in sync: the pipeline has not written a
  // faststart mp4 for anything else, so the theater scope is ready clips only.
  const initialPages = browseTabs(db, query, { tabs: [...SORTS], scope: "theater", userId: user.id }).tabs;

  return (
    <Theater
      me={user.authentikUsername}
      thumbs={listReadyThumbs(db)}
      initialQuery={query}
      initialPages={initialPages}
      options={listBrowseOptions(db)}
    />
  );
}
