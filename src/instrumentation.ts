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

  void scan();
}
