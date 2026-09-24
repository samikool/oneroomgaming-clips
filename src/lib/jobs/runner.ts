import { claimNextJob, completeJob, failJob } from "@/db/jobs";
import { setClipStatus } from "@/db/clips";
import { removeSourceArtifacts } from "@/lib/media/cleanup";
import { handlers } from "./handlers";
import type { JobContext } from "./types";

export async function runOnce(ctx: JobContext): Promise<boolean> {
  const job = claimNextJob(ctx.db);

  if (!job) {
    return false;
  }

  try {
    await handlers[job.type](ctx, job);
    completeJob(ctx.db, job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = failJob(ctx.db, job.id, message);
    if (exhausted) {
      // Retries are spent; the clip is permanently stuck, and its
      // pre-publish source bytes will never be consumed by a later stage.
      setClipStatus(ctx.db, job.clipId, "failed", message);
      removeSourceArtifacts(ctx.env, job.clipId);
    }
    console.error(`job ${job.type} failed for clip ${job.clipId}: ${message}`);
  }

  return true;
}

export function startRunner(ctx: JobContext, intervalMs = 2000): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) {
      return;
    }

    try {
      // Drain the queue rather than doing one job per interval, so a chained
      // pipeline finishes promptly instead of taking intervalMs per step.
      while (!stopped && (await runOnce(ctx))) {
        // keep going
      }
    } catch (error) {
      console.error("job runner tick failed", error);
    }

    if (!stopped) {
      setTimeout(tick, intervalMs);
    }
  };

  void tick();

  return () => {
    stopped = true;
  };
}
