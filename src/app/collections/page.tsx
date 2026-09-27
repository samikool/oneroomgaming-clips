import { CollectionGrid } from "@/components/collection-card";
import { CollectionsLive } from "@/components/collection-clips";
import { NewCollection } from "@/components/collection-editor";
import { getDb } from "@/db/client";
import { listCollections } from "@/db/collections";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  await requireUser();
  const collections = listCollections(getDb(), {});

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <CollectionsLive />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Collections</h1>
          <p className="mt-1 text-sm text-ink-muted">Named lists of clips. Anyone can look; the owner decides who adds.</p>
        </div>
        <NewCollection />
      </header>
      <CollectionGrid collections={collections} empty="No collections yet. Make the first one." />
    </main>
  );
}
