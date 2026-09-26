import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getProfile } from "@/db/profiles";
import { listAppearancesOf, listCommentsBy, listUploadsBy } from "@/db/profile-activity";
import { ProfileHeader } from "@/components/profile-header";
import { ProfileTabs } from "@/components/profile-tabs";
import { toSummary } from "@/lib/events/clips";
import { usernameFromParam } from "@/lib/profiles/href";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const me = await requireUser();
  const username = usernameFromParam((await params).username);
  const db = getDb();
  const profile = getProfile(db, username);

  if (!profile) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <ProfileHeader username={profile.username} isMe={me.authentikUsername === profile.username} />
      <ProfileTabs
        uploads={listUploadsBy(db, profile.userId).map(toSummary)}
        appearances={listAppearancesOf(db, profile.userId).map(toSummary)}
        comments={listCommentsBy(db, profile.userId)}
        now={Date.now()}
      />
    </main>
  );
}
