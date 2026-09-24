import type { CommentRow } from "@/db/comments";
import { publish } from "@/lib/realtime/publish";

/**
 * Tells everyone about a new comment.
 *
 * `CommentRow` already matches `CommentSummary` on the wire, so there is
 * nothing to map. `publish` never throws — a comment that saved must not 500
 * because the socket service is down.
 */
export async function announceComment(
  comment: CommentRow,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<void> {
  await publish({ t: "comment.added", comment }, env);
}
