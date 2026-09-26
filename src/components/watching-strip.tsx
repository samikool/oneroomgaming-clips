"use client";

import { Avatar } from "./avatar";
import { UserName } from "./user-name";

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
        // No profile link inside: for the host, clicking a name means "give control".
        const content = (
          <>
            <Avatar username={user} size={16} />
            <UserName username={user} variant="compact" link={false} />
            {user === me && " (you)"}
            {user === hostUserId && " 👑"}
          </>
        );

        return iAmHost && user !== me ? (
          <button
            key={user}
            type="button"
            className="watching-name watching-name-button"
            title={`Give ${user} control`}
            onClick={() => onGiveControl(user)}
          >
            {content}
          </button>
        ) : (
          <span key={user} className="watching-name" title={label}>
            {content}
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
