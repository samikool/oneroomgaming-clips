export type OnlinePerson = { username: string; inTheater: boolean };

/**
 * Who else is here, for the header's "N online" pill. You are never counted:
 * "1 online" while you sit alone reads as someone else being around.
 * People in the theater come first — they're the ones worth joining.
 */
export function summarizePresence(
  online: string[],
  inRoom: string[],
  me: string,
): { count: number; others: OnlinePerson[] } {
  const watching = new Set(inRoom);
  const others = [...new Set(online)]
    .filter((username) => username !== me)
    .map((username) => ({ username, inTheater: watching.has(username) }))
    .sort((a, b) => Number(b.inTheater) - Number(a.inTheater) || a.username.localeCompare(b.username));

  return { count: others.length, others };
}
