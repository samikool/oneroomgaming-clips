"use client";

/**
 * Who is in the room, as one line under the player. The host hands control
 * over by clicking a name — immediate, like the list it replaces. When nobody
 * has control, anyone present can take it.
 */
export function WatchingStrip({
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

  return (
    <div className="watching-strip">
      <span className="text-ink-muted">Watching:</span>
      {inRoom.length === 0 && <span className="text-ink-muted">nobody yet</span>}
      {inRoom.map((user) => {
        const label = `${user}${user === me ? " (you)" : ""}${user === hostUserId ? " 👑" : ""}`;

        return iAmHost && user !== me ? (
          <button
            key={user}
            type="button"
            className="watching-name watching-name-button"
            title={`Give ${user} control`}
            onClick={() => onGiveControl(user)}
          >
            {label}
          </button>
        ) : (
          <span key={user} className="watching-name">
            {label}
          </span>
        );
      })}
      {hostUserId === null && inRoom.includes(me) && (
        <button type="button" className="chip-button ml-auto" onClick={onClaimHost}>
          Take control
        </button>
      )}
      {iAmHost && inRoom.length > 1 && (
        <span className="ml-auto text-xs text-ink-muted">Click a name to hand over control</span>
      )}
    </div>
  );
}
