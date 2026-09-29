import { claimNextJob, completeJob, failJob } from "@/db/jobs";
import { getClip, setClipStatus } from "@/db/clips";
import { removeSourceArtifacts } from "@/lib/media/cleanup";
import { announceClipUpdated } from "@/lib/events/clips";
import { getAdminJob } from "@/db/admin/jobs";
import { publish } from "@/lib/realtime/publish";
import { handlers } from "./handlers";
import type { JobContext } from "./types";

/**
 * Tells the admin's jobs panel a job changed status. Fire-and-forget like
 * every publish: a slow realtime must never hold up the pipeline.
 */
function announceJob(ctx: JobContext, id: string): void {
  const job = getAdminJob(ctx.db, id);

  if (job) {
    void publish({ t: "job.updated", job }, ctx.env);
  }
}

export async function runOnce(ctx: JobContext, now: Date = new Date()): Promise<boolean> {
  const job = claimNextJob(ctx.db, now);

  if (!job) {
    return false;
  }

  announceJob(ctx, job.id);

  // The retry is underway, so the clip is processing again. Announced now: a
  // long stage would otherwise show "Retrying" for the whole attempt.
  if (getClip(ctx.db, job.clipId)?.status === "retrying") {
    setClipStatus(ctx.db, job.clipId, "processing");
    await announceClipUpdated(ctx.db, job.clipId, ctx.env);
  }

  try {
    await handlers[job.type](ctx, job);
    completeJob(ctx.db, job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = failJob(ctx.db, job.id, message, now);
    if (!exhausted) {
      // Uploaders see this rather than a spinner that silently restarts.
      setClipStatus(ctx.db, job.clipId, "retrying", message);
    } else {
      // Retries are spent; the clip is permanently stuck, and its
      // pre-publish source bytes will never be consumed by a later stage.
      setClipStatus(ctx.db, job.clipId, "failed", message);
      removeSourceArtifacts(ctx.env, job.clipId);
    }
    console.error(`job ${job.type} failed for clip ${job.clipId}: ${message}`);
  }

  announceJob(ctx, job.id);

  // One announce covers every pipeline transition — processing, ready,
  // needs_transcode, failed — without instrumenting each status setter.
  // It cannot fail the job: publish swallows its own errors.
  await announceClipUpdated(ctx.db, job.clipId, ctx.env);

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
