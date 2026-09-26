/**
 * Turns what someone typed into an FTS5 MATCH expression. Every word becomes a
 * quoted prefix term, so nothing a person types — OR, NEAR, -, :, * — is ever
 * read as an operator.
 */
export function toFtsQuery(q: string): string | null {
  const words = q.trim().split(/\s+/).filter((word) => word.length > 0);

  if (words.length === 0) {
    return null;
  }

  return words.map((word) => `"${word.replaceAll('"', '""')}"*`).join(" AND ");
}
