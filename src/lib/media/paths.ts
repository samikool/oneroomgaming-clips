import { join } from "node:path";

export function mediaRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.MEDIA_ROOT ?? "./data/media";
}

export function incomingDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(mediaRoot(env), "incoming");
}

export function clipsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(mediaRoot(env), "clips");
}

export function thumbsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(mediaRoot(env), "thumbs");
}

export function clipFilename(id: string): string {
  return `${id}.mp4`;
}

export function thumbFilename(id: string): string {
  return `${id}.jpg`;
}

export function clipPublicPath(id: string): string {
  return `/media/clips/${clipFilename(id)}`;
}

export function thumbPublicPath(id: string): string {
  return `/media/thumbs/${thumbFilename(id)}`;
}
