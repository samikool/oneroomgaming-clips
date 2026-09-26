import { asc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { users, type User } from "./schema";
import { defaultAccent, isAccentKey } from "@/lib/profiles/palette";
import type { Profile } from "@/lib/profiles/types";

export type { Profile };

/**
 * The only door to profile data. When Authentik becomes the source of truth
 * for profiles, this is the module that changes.
 */

const NAME_MAX = 32;
const BIO_MAX = 160;
// Control characters, except that a bio may keep its line breaks.
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

type Field = "name" | "accent" | "bio";

export class ProfileValidationError extends Error {
  constructor(readonly fields: Partial<Record<Field, string>>) {
    super(Object.values(fields).join(" "));
    this.name = "ProfileValidationError";
  }
}

export function toProfile(user: User): Profile {
  return {
    username: user.authentikUsername,
    userId: user.id,
    name: user.profileName ?? user.displayName ?? user.authentikUsername,
    accent: isAccentKey(user.accent) ? user.accent : defaultAccent(user.authentikUsername),
    bio: user.bio,
    pictureVersion: user.pictureVersion,
  };
}

function findUser(db: Db, username: string): User | undefined {
  return db.select().from(users).where(eq(users.authentikUsername, username)).get();
}

export function listProfiles(db: Db): Profile[] {
  return db.select().from(users).orderBy(asc(users.authentikUsername)).all().map(toProfile);
}

export function getProfile(db: Db, username: string): Profile | undefined {
  const user = findUser(db, username);
  return user ? toProfile(user) : undefined;
}

/** Code points, so an emoji counts once rather than as two UTF-16 units. */
function length(text: string): number {
  return [...text].length;
}

export function updateProfile(
  db: Db,
  username: string,
  patch: { name?: string; accent?: string; bio?: string },
): Profile {
  const user = findUser(db, username);

  if (!user) {
    throw new Error(`No user ${username}`);
  }

  const errors: Partial<Record<Field, string>> = {};
  const set: Partial<Pick<User, "profileName" | "accent" | "bio">> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (CONTROL.test(name)) {
      errors.name = "Names can't contain control characters.";
    } else if (length(name) > NAME_MAX) {
      errors.name = `Names are at most ${NAME_MAX} characters.`;
    } else {
      set.profileName = name.length === 0 ? null : name;
    }
  }

  if (patch.accent !== undefined) {
    if (isAccentKey(patch.accent)) {
      set.accent = patch.accent;
    } else {
      errors.accent = "Pick one of the palette colours.";
    }
  }

  if (patch.bio !== undefined) {
    const bio = patch.bio.trim();
    if (CONTROL_EXCEPT_NEWLINE.test(bio)) {
      errors.bio = "Bios can't contain control characters.";
    } else if (length(bio) > BIO_MAX) {
      errors.bio = `Bios are at most ${BIO_MAX} characters.`;
    } else {
      set.bio = bio.length === 0 ? null : bio;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ProfileValidationError(errors);
  }

  if (Object.keys(set).length === 0) {
    return toProfile(user);
  }

  return toProfile(db.update(users).set(set).where(eq(users.id, user.id)).returning().get());
}

export function setPictureVersion(db: Db, username: string, version: number | null): Profile {
  const row = db
    .update(users)
    .set({ pictureVersion: version })
    .where(eq(users.authentikUsername, username))
    .returning()
    .get();

  if (!row) {
    throw new Error(`No user ${username}`);
  }

  return toProfile(row);
}
