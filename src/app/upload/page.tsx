import Link from "next/link";
import { requireUser } from "@/lib/session";
import { UploadPanel } from "@/components/upload-panel";
export const dynamic = "force-dynamic";
export default async function UploadPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">Back to clips</Link>
      <h1 className="mb-3 mt-8 text-3xl font-semibold tracking-tight">Upload clips</h1>
      <p className="mb-8 text-ink-muted">Share a round worth watching with the room.</p>
      <UploadPanel username={user.authentikUsername} />
    </main>
  );
}
