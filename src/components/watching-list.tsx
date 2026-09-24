"use client";

/**
 * Who is in the room, who has control, and — for the host — the buttons to
 * hand it over. The handoff lives here rather than in the player because it is
 * a fact about people, not about transport.
 */
export function WatchingList({
  inRoom,
  hostUserId,
  me,
  onGiveControl,
  onClaimHost,
}: {
  inRoom: string[];
  hostUserId: string | null;
  me: string;
  onGiveControl(user: string): void;
  onClaimHost(): void;
}) {
  const iAmHost = hostUserId === me;

  if (inRoom.length === 0) {
    return <p className="p-4 text-sm text-ink-muted">Nobody is in the theater yet.</p>;
  }

  return (
    <div className="p-4">
      {hostUserId === null && inRoom.includes(me) && (
        <button type="button" className="button-primary mb-4 w-full" onClick={onClaimHost}>
          Take control
        </button>
      )}
      <ul className="flex flex-col gap-2">
        {inRoom.map((user) => (
          <li key={user} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-ink">
              {user === me ? `${user} (you)` : user}
            </span>
            {user === hostUserId && <span className="text-xs text-ink-muted">host</span>}
            {iAmHost && user !== me && (
              <button type="button" className="chip-button" onClick={() => onGiveControl(user)}>
                Give control
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
