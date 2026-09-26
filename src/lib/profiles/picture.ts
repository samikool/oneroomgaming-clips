import { join } from "node:path";
import { mediaRoot } from "@/lib/media/paths";

export { pictureFilename, picturePath, type PictureSize } from "./picture-path";

export function avatarsDir(env: Partial<NodeJS.ProcessEnv> = process.env): string {
  return join(mediaRoot(env), "avatars");
}
