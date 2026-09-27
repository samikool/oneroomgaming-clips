"use client";

import { useState } from "react";
import { postComment } from "@/app/clips/[id]/actions";
import { MAX_CHAT_LENGTH } from "@/lib/realtime/chat";
import { MentionInput } from "./mention-input";
import { useClipPlayhead } from "./clip-playhead";

export function CommentForm({ clipId }: { clipId: string }) {
  const [draft, setDraft] = useState("");
  const { currentMs } = useClipPlayhead();

  return (
    <form
      className="comment-form"
      action={async (formData) => {
        // Clear optimistically: the comment arrives back over the socket, so
        // leaving the text sitting there makes it look like it failed.
        setDraft("");
        // Anchored to the playhead, in whole seconds, once the video has
        // played: a comment typed before pressing play isn't about a moment.
        const at = Math.floor(currentMs() / 1000) * 1000;
        if (at > 0) formData.set("positionMs", String(at));
        await postComment(clipId, formData);
      }}
    >
      <MentionInput
        name="body"
        className="title-input"
        value={draft}
        onChange={setDraft}
        maxLength={MAX_CHAT_LENGTH}
        placeholder="Add a comment"
        aria-label="Comment"
      />
      <button type="submit" className="button-secondary">
        Post
      </button>
    </form>
  );
}
