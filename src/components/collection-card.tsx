import Link from "next/link";
import type { CollectionSummary } from "@/db/collections";
import { UserName } from "./user-name";

/**
 * A collection as a card: a 2×2 mosaic of its first four thumbnails, then
 * name, owner and count. The owner's name doesn't link — the whole card does,
 * and an anchor inside an anchor is invalid HTML.
 */
export function CollectionCard({ collection }: { collection: CollectionSummary }) {
  const cells = [0, 1, 2, 3].map((i) => collection.thumbs[i]);

  return (
    <Link href={`/collections/${collection.id}`} className="block">
      <div className="clip-tile">
      <div className="collection-mosaic" aria-hidden="true">
        {cells.map((thumb, i) =>
          thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span key={i} className="bg-surface-sunken" />
          ),
        )}
      </div>
      <div className="p-2">
        <p className="flex items-center gap-2">
          <span className="truncate text-sm text-ink">{collection.name}</span>
          {collection.open && <span className="collection-open-badge">open</span>}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
          <UserName username={collection.owner} variant="compact" link={false} />
          <span aria-hidden="true">·</span>
          <span>
            {collection.clipCount} {collection.clipCount === 1 ? "clip" : "clips"}
          </span>
        </p>
      </div>
      </div>
    </Link>
  );
}

export function CollectionGrid({ collections, empty }: { collections: CollectionSummary[]; empty: string }) {
  if (collections.length === 0) {
    return <p className="text-sm text-ink-muted">{empty}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {collections.map((collection) => (
        <CollectionCard key={collection.id} collection={collection} />
      ))}
    </div>
  );
}
