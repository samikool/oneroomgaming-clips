"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { ProfileValidationError, updateProfile, type Profile } from "@/db/profiles";
import { publish } from "@/lib/realtime/publish";
import { profileHref } from "@/lib/profiles/href";
import { requireUser } from "@/lib/session";

type Fields = Partial<Record<"name" | "accent" | "bio", string>>;

export type SaveProfileResult = { ok: true; profile: Profile } | { ok: false; fields: Fields };

/** A field the form sent, or undefined so updateProfile leaves it alone. */
function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * You can only edit you: the username comes from the identity, never the
 * form. Nothing is saved unless every field is valid.
 */
export async function saveProfile(formData: FormData): Promise<SaveProfileResult> {
  const user = await requireUser();

  try {
    const profile = updateProfile(getDb(), user.authentikUsername, {
      name: field(formData, "name"),
      accent: field(formData, "accent"),
      bio: field(formData, "bio"),
    });
    await publish({ t: "profile.updated", profile });
    revalidatePath(profileHref(user.authentikUsername));
    // Returned as well as broadcast, so the saver sees it even with realtime down.
    return { ok: true, profile };
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      return { ok: false, fields: error.fields };
    }
    throw error;
  }
}
