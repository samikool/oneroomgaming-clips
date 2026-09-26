import type { AccentKey } from "./palette";

/** A person as every surface shows them. Fallbacks are already applied. */
export type Profile = {
  username: string;
  userId: string;
  name: string;
  accent: AccentKey;
  bio: string | null;
  pictureVersion: number | null;
};
