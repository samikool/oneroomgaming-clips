import { UploadPanel } from "@/components/upload-panel";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">Upload clips</h1>
      <p className="mb-8 text-ink-muted">Share a round worth watching with the room.</p>
      <UploadPanel />
    </main>
  );
}
