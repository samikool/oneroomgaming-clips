import { join } from "node:path";
import { applyProbe, getClip, recordMediaFile, setClipStatus, setClipThumb } from "@/db/clips";
import { enqueueStage } from "@/db/jobs";
import type { JobType } from "@/db/schema";
import { isPlayableAudio, isPlayableVideo } from "@/lib/media/codecs";
import { removeSourceArtifacts } from "@/lib/media/cleanup";
import { hasObsLeadIn } from "@/lib/media/editlist";
import {
  clipFilename, clipsDir, incomingDir, thumbFilename,
  thumbPublicPath, thumbsDir,
} from "@/lib/media/paths";
import { probeFile } from "@/lib/media/probe";
import { waitUntilReadable } from "@/lib/media/settle";
import { onClipReady } from "@/lib/social/events";
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
  const input = incomingPath(ctx, job.clipId);
  await waitUntilReadable(input);
  const info = await probeFile(input);
  applyProbe(ctx.db, job.clipId, info);

  // Only the video decides: audio a browser can't play is converted by remux.
  if (!isPlayableVideo(info.videoCodec, info.pixelFormat)) {
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

  // OBS replay clips hide a lead-in back to the previous keyframe behind an
  // edit list, and players freeze decoding it. Keep it as visible footage
  // instead; every other file is remuxed untouched.
  const stripLeadIn = await hasObsLeadIn(input);
  const convertAudio = !isPlayableAudio(getClip(ctx.db, job.clipId)?.audioCodec ?? null);
  await remuxFaststart(input, output, undefined, { ignoreEditList: stripLeadIn, convertAudio });

  const info = await probeFile(output);

  if (stripLeadIn || convertAudio) {
    // The clip row was filled from the incoming file: its duration excluded
    // the lead-in, and its audio codec was the one replaced. Describe the
    // stored file instead.
    applyProbe(ctx.db, job.clipId, info);
  }

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
  await onClipReady(ctx.db, job.clipId);
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
