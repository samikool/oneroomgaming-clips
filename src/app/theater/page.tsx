import { Theater } from "@/components/theater";
import { getDb } from "@/db/client";
import { listAllClips } from "@/db/clips";
import { toSummary } from "@/lib/events/clips";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TheaterPage() {
  const user = await requireUser();
  // Only a finished clip can be played in sync: the pipeline has not written a
  // faststart mp4 for anything else, so a follower would stall on the moov.
  const clips = listAllClips(getDb())
    .filter((clip) => clip.status === "ready")
    .map(toSummary);

  return <Theater me={user.authentikUsername} clips={clips} />;
}
