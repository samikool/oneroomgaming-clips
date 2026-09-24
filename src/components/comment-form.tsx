"use client";

import { useRef } from "react";
import { postComment } from "@/app/clips/[id]/actions";
import { MAX_CHAT_LENGTH } from "@/lib/realtime/chat";

export function CommentForm({ clipId }: { clipId: string }) {
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <form
      ref={formRef}
      className="comment-form"
      action={async (formData) => {
        // Clear optimistically: the comment arrives back over the socket, so
        // leaving the text sitting there makes it look like it failed.
        formRef.current?.reset();
        await postComment(clipId, formData);
      }}
    >
      <input
        name="body"
        className="title-input"
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
