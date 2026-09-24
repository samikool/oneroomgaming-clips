import { join } from "node:path";
import { applyProbe, recordMediaFile, setClipStatus, setClipThumb } from "@/db/clips";
import { enqueueStage } from "@/db/jobs";
import type { JobType } from "@/db/schema";
import { isBrowserPlayable } from "@/lib/media/codecs";
import { removeSourceArtifacts } from "@/lib/media/cleanup";
import {
  clipFilename, clipsDir, incomingDir, thumbFilename,
  thumbPublicPath, thumbsDir,
} from "@/lib/media/paths";
import { probeFile } from "@/lib/media/probe";
import { extractThumbnail, remuxFaststart } from "@/lib/media/transform";
import type { JobContext, JobHandler } from "./types";

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is registered but not implemented yet`);
    this.name = "NotImplementedError";
  }
}

function incomingPath(ctx: JobContext, clipId: string): string {
  return join(incomingDir(ctx.env), clipFilename(clipId));
}

const probe: JobHandler = async (ctx, job) => {
  const info = await probeFile(incomingPath(ctx, job.clipId));
  applyProbe(ctx.db, job.clipId, info);

  if (!isBrowserPlayable(info.videoCodec, info.audioCodec, info.pixelFormat)) {
    setClipStatus(
      ctx.db,
      job.clipId,
      "needs_transcode",
      `unsupported codecs: ${info.videoCodec}/${info.audioCodec}`,
    );
    removeSourceArtifacts(ctx.env, job.clipId);
    return;
  }

  setClipStatus(ctx.db, job.clipId, "processing");
  enqueueStage(ctx.db, job.clipId, "remux");
};

const remux: JobHandler = async (ctx, job) => {
  const input = incomingPath(ctx, job.clipId);
  const output = join(clipsDir(ctx.env), clipFilename(job.clipId));

  await remuxFaststart(input, output);

  const info = await probeFile(output);
  recordMediaFile(ctx.db, job.clipId, {
    kind: "original",
    path: output,
    info,
    isDefault: true,
  });

  enqueueStage(ctx.db, job.clipId, "thumbnail");
};

const thumbnail: JobHandler = async (ctx, job) => {
  const input = join(clipsDir(ctx.env), clipFilename(job.clipId));
  const output = join(thumbsDir(ctx.env), thumbFilename(job.clipId));

  await extractThumbnail(input, output);

  setClipThumb(ctx.db, job.clipId, thumbPublicPath(job.clipId));
  setClipStatus(ctx.db, job.clipId, "ready");
  removeSourceArtifacts(ctx.env, job.clipId);
};

const transcode: JobHandler = async () => {
  throw new NotImplementedError("transcode");
};

export const handlers: Record<JobType, JobHandler> = {
  probe,
  remux,
  thumbnail,
  transcode,
};
