"use client";

import { useState, useTransition } from "react";
import { Avatar } from "./avatar";
import { exportPicture, PictureCropper, type PendingPicture } from "./picture-cropper";
import { useApplyProfile, useProfile } from "./profiles-provider";
import { saveProfile } from "@/app/u/[username]/actions";
import { ACCENT_KEYS, ACCENTS, type AccentKey } from "@/lib/profiles/palette";
import type { Profile } from "@/lib/profiles/types";

// Mirrors the server's limits for the counters. The server is the authority.
const NAME_MAX = 32;
const BIO_MAX = 160;

type Errors = Partial<Record<"name" | "accent" | "bio" | "picture", string>>;

/** Code points, as the server counts, so an emoji is one character here too. */
function count(text: string): number {
  return [...text.trim()].length;
}

async function uploadPicture(picture: PendingPicture): Promise<Profile> {
  const { s256, s64 } = await exportPicture(picture);
  const form = new FormData();
  form.append("s256", s256, "256.webp");
  form.append("s64", s64, "64.webp");

  const response = await fetch("/api/profile/picture", { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as { profile?: Profile; error?: string };

  if (!response.ok || !body.profile) {
    throw new Error(body.error ?? "That picture didn't upload. Try again.");
  }

  return body.profile;
}

/**
 * Your profile header, turned into a form. Text saves through a server action
 * that checks everything before writing anything; a new picture uploads only
 * once the text has saved.
 */
export function ProfileEditor({ username, onDone }: { username: string; onDone(): void }) {
  const profile = useProfile(username);
  const applyProfile = useApplyProfile();
  const [name, setName] = useState(profile.name);
  const [accent, setAccent] = useState<AccentKey>(profile.accent);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [picture, setPicture] = useState<PendingPicture | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();

  function save(formData: FormData): void {
    // An untouched name is left out, so someone still showing their Authentik
    // name keeps following it rather than having it frozen in as a choice.
    if (name === profile.name) {
      formData.delete("name");
    }

    startTransition(async () => {
      const result = await saveProfile(formData);

      if (!result.ok) {
        setErrors(result.fields);
        return;
      }

      applyProfile(result.profile);

      if (picture) {
        try {
          applyProfile(await uploadPicture(picture));
        } catch (error) {
          setErrors({ picture: (error as Error).message });
          return;
        }
      }

      onDone();
    });
  }

  function removePicture(): void {
    startTransition(async () => {
      const response = await fetch("/api/profile/picture", { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { profile?: Profile };

      if (response.ok && body.profile) {
        applyProfile(body.profile);
        setPicture(null);
      } else {
        setErrors({ picture: "Couldn't remove your picture. Try again." });
      }
    });
  }

  return (
    <form
      className="profile-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save(new FormData(event.currentTarget));
      }}
    >
      <fieldset className="profile-editor-picture">
        <legend className="metadata-label">Picture</legend>
        {!picture && <Avatar username={username} size={96} />}
        <PictureCropper value={picture} onChange={setPicture} />
        {!picture && profile.pictureVersion !== null && (
          <button type="button" className="chip-button" disabled={pending} onClick={removePicture}>
            Remove picture
          </button>
        )}
        {errors.picture && <p className="text-xs text-danger">{errors.picture}</p>}
      </fieldset>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="metadata-label">
            Name <span className="ml-1">{count(name)}/{NAME_MAX}</span>
          </span>
          <input
            name="name"
            className="title-input"
            value={name}
            placeholder={username}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
          {errors.name && <span className="text-xs text-danger">{errors.name}</span>}
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="metadata-label">Colour</legend>
          <div className="accent-swatches">
            {ACCENT_KEYS.map((key) => (
              <label key={key} className="accent-swatch" style={{ background: ACCENTS[key] }}>
                <input
                  type="radio"
                  name="accent"
                  value={key}
                  checked={accent === key}
                  aria-label={key}
                  className="sr-only"
                  onChange={() => setAccent(key)}
                />
              </label>
            ))}
          </div>
          {errors.accent && <span className="text-xs text-danger">{errors.accent}</span>}
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="metadata-label">
            Bio <span className="ml-1">{count(bio)}/{BIO_MAX}</span>
          </span>
          <textarea
            name="bio"
            className="title-input"
            rows={3}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
          {errors.bio && <span className="text-xs text-danger">{errors.bio}</span>}
        </label>

        <div className="flex gap-2">
          <button type="submit" className="button-primary" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="button-secondary" disabled={pending} onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
