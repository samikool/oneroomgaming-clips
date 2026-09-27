"use client";

import { Fragment, useMemo } from "react";
import { useDirectory } from "./profiles-provider";
import { UserName } from "./user-name";
import { splitMentions } from "@/lib/social/mentions";

/** Text with each known `@username` shown as that person's name, in their colour. */
export function MentionText({ text }: { text: string }) {
  const directory = useDirectory();
  const known = useMemo(() => new Set(directory.map((p) => p.username)), [directory]);
  const parts = useMemo(() => (text.includes("@") ? splitMentions(text, known) : [{ text }]), [text, known]);

  return (
    <>
      {parts.map((part, i) =>
        "username" in part ? (
          <UserName key={i} username={part.username} variant="compact" />
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
