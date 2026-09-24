import { ClipCard, type ClipCardData } from "./clip-card";

export function ClipGrid({ clips }: { clips: ClipCardData[] }) {
  if (clips.length === 0) {
    return (
      <p className="text-ink-muted">
        No clips yet. Upload a video to give the room something to watch.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} />
      ))}
    </div>
  );
}
