"use client";

import { useState, useTransition } from "react";
import { removePictureAction, resetNameAction } from "@/app/admin/actions";
import type { AdminUser } from "@/db/admin/users";
import { formatBytes } from "@/lib/format";
import { Avatar } from "../avatar";
import { UserName } from "../user-name";
import { When } from "./when";

/** Everyone who has signed in, with the two things an admin can undo for them. */
export function UsersPanel({ users }: { users: AdminUser[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th />
            <th>Name</th>
            <th>Last seen</th>
            <th>Previous visit</th>
            <th>Clips</th>
            <th>Size</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow key={user.profile.username} user={user} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { profile } = user;

  function run(action: (username: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
    startTransition(async () => {
      const result = await action(profile.username);
      setMessage(result.ok ? null : result.error);
    });
  }

  return (
    <tr>
      <td>
        <Avatar username={profile.username} size={32} />
      </td>
      <td>
        <UserName username={profile.username} withAvatar={false} />
        {message && <span className="admin-message block">{message}</span>}
      </td>
      <td className="whitespace-nowrap"><When at={user.lastSeenAt} /></td>
      <td className="whitespace-nowrap"><When at={user.previousVisitAt} /></td>
      <td className="font-pixel text-[11px]">{user.clips}</td>
      <td className="whitespace-nowrap">{formatBytes(user.bytes)}</td>
      <td>
        <span className="flex justify-end gap-1">
          <button type="button" className="admin-small-button" disabled={pending || !user.hasChosenName} onClick={() => run(resetNameAction)}>
            Reset name
          </button>
          <button
            type="button"
            className="admin-small-button admin-small-danger"
            disabled={pending || profile.pictureVersion === null}
            onClick={() => run(removePictureAction)}
          >
            Remove picture
          </button>
        </span>
      </td>
    </tr>
  );
}
