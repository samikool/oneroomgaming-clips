export async function register() {
  // Next runs this hook in both the node and edge runtimes; the pipeline only
  // belongs in the node one, and only in the web process.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { getDb } = await import("@/db/client");
  const { startRunner } = await import("@/lib/jobs/runner");
  const { scanIncoming } = await import("@/lib/ingest/scan");

  const ctx = { db: getDb(), env: process.env };
  const SCAN_INTERVAL_MS = 5000;

  const state = globalThis as typeof globalThis & { clipsPipelineStarted?: boolean };
  if (state.clipsPipelineStarted) return;
  state.clipsPipelineStarted = true;

  const { recoverRunningJobs } = await import("@/db/jobs");
  recoverRunningJobs(ctx.db);
  startRunner(ctx);

  const scan = async () => {
    try {
      const created = await scanIncoming(ctx);
      if (created.length > 0) {
        console.log(`ingest: picked up ${created.length} new clip(s)`);
      }
    } catch (error) {
      console.error("ingest scan failed", error);
    }
    setTimeout(scan, SCAN_INTERVAL_MS);
  };

  const { getUploadService } = await import("@/lib/uploads/server");
  const maintainUploads = async () => {
    try { await getUploadService().sweep(); }
    catch (error) { console.error("upload maintenance failed", error); }
    setTimeout(maintainUploads, 60_000);
  };
  void maintainUploads();
  void scan();
}
