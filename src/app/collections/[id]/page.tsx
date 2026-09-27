import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionClips } from "@/components/collection-clips";
import { CollectionOwnerControls } from "@/components/collection-editor";
import { UserName } from "@/components/user-name";
import { getDb } from "@/db/client";
import { getCollection } from "@/db/collections";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const collection = getCollection(getDb(), id, user.id);

  if (!collection) {
    notFound();
  }

  const isOwner = collection.owner === user.authentikUsername;
  const ready = collection.clips.filter((c) => c.status === "ready").length;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <Link href="/collections" className="text-sm text-ink-muted hover:text-ink">
        ← collections
      </Link>
      <header className="mb-6 mt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight text-ink">
              <span className="min-w-0 break-words">{collection.name}</span>
              {collection.open && <span className="collection-open-badge">open</span>}
            </h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
              <UserName username={collection.owner} />
              <span aria-hidden="true">·</span>
              {collection.clipCount} {collection.clipCount === 1 ? "clip" : "clips"}
            </p>
            {collection.description && (
              <p className="mt-3 max-w-2xl whitespace-pre-line text-sm text-ink">{collection.description}</p>
            )}
          </div>
          {ready > 0 && (
            <Link href={`/theater?load=${collection.id}`} className="button-primary">
              Play in theater
            </Link>
          )}
        </div>
        {isOwner && <CollectionOwnerControls collection={collection} />}
      </header>
      <CollectionClips
        collectionId={collection.id}
        clips={collection.clips}
        me={user.authentikUsername}
        isOwner={isOwner}
        open={collection.open}
      />
    </main>
  );
}
