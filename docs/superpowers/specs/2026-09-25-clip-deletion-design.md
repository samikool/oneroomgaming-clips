# Clip deletion — design

> Written **after** implementation, at Sam's instruction to skip the spec
> review gate and go straight to code. It records what was built and why, and
> is not a plan for future work.

**Goal:** an admin can select clips in the library and delete them
permanently — rows, files and disk space — without breaking anyone who is
looking at the site while it happens.

**Shipped in:** 0.1.1.

## The four decisions

Each was chosen deliberately over a named alternative.

### 1. Admin-ness is configuration, not data

`CLIPS_ADMINS` is a comma-separated list of `authentik_username` values.
`isAdmin(username, env)` is pure and lives in `src/lib/auth.ts` — not
`session.ts` — for the reason already documented there: `src/realtime/` may
import that module and may not import `next/*` or the database.

Rejected: a `users.is_admin` column, which is a migration for a boolean with
no UI, edited by hand in production SQLite. Also rejected: an Authentik
group. `X-Authentik-Groups` is already in Caddy's `copy_headers`, so that
option is live if the admin set ever needs to be dynamic — but the dev
identity fallback has no groups, so it would mean maintaining an env path
anyway. Swapping `isAdmin` for a group lookup is a one-function change
because every caller goes through it.

**Unset means nobody is an admin.** Failing closed is the only safe
direction.

### 2. Hard delete, in a transaction

`deleteClipCascade` removes comments, clip_tags, clip_participants, views,
jobs and media_files, then the clip, inside one transaction.

The pre-existing `deleteClip` could not do this and never could have: with
`PRAGMA foreign_keys = ON` and no `onDelete` declared on any child FK, a bare
row delete raises FOREIGN KEY constraint failed for any clip that has been
through the pipeline — which is every real clip, since all of them have
`jobs` and `media_files` rows. It had exactly one caller, a test, deleting a
childless clip.

`tags` and `games` rows survive; only the join rows go. They are shared
vocabulary, not owned by one clip.

Rejected: a `deleted_at` column. It would have left the disk-usage figure
added in milestone 6 permanently untruthful, and put a `deleted_at IS NULL`
predicate on six query functions where missing one makes a "deleted" clip
still playable by direct URL. Also rejected: soft delete plus a reaper job,
which costs all of that plus a new job type and a scheduling trigger the
runner does not have.

### 3. Database first, files second, outside the transaction

`removeClips` commits the cascade, then calls `removeClipFiles`, then
announces.

A failed unlink after the commit orphans bytes on disk: invisible and
reclaimable. The other order leaves a surviving row pointing at a video that
is gone, which renders as a broken card in everyone's grid. Orphaned bytes
beat a broken card.

Announcing is last and cannot fail the deletion — `publish` swallows its own
errors, so realtime being down costs a live update, not the delete. This is
the property the ingest pipeline already has.

### 4. The removal reaches the theater, not just the grid

`clip.removed` carries only a `clipId`, because by publish time there is no
row left to summarise. It routes to the `grid` topic and is **not**
ephemeral: a client that misses it keeps showing a card for a video that is
gone and never recovers on its own.

`/emit` gained its first branch that acts on a message rather than only
relaying it. When the removed clip is the one playing, `Room.clearIfClip`
resets the room and bumps `rev` so followers apply it. Members and the host
stay — a deletion is not a reason to throw everyone out.

Rejected: refusing to delete a clip that is playing. `web` has no way to read
room state, so it would need a new inbound call in the opposite direction of
`/emit`, making `web` block on realtime being up when every other path is
fire-and-forget — and it would still be racy, since the host can change clips
between the check and the delete.

## Where authorization lives

`requireAdmin()` at the server-action boundary, and nowhere else.

This deviates from the `removeComment` precedent, which pushes its check down
into `softDeleteComment`. That is right for comments because ownership is
**per row** — the db layer is the only place that knows who wrote one.
Admin-ness is **per user** and row-independent, so the action boundary is the
single correct place. `deleteClipCascade` stays a pure data operation with no
identity parameter; threading a user id into it would be a check that has no
business being there.

Hiding the Select button is presentation. `deleteClips` calls `requireAdmin`
itself, before reading or writing anything, and narrows its own argument —
a server action's parameters are as untrusted as a request body.

## Selection

`toggleSelection` and `pruneSelection` are pure functions over a `Set` of
ids, so the grid's most error-prone state is testable without rendering.

`pruneSelection` exists for one bug: another admin deletes a clip you have
selected, the card vanishes, and the action bar keeps counting it. It returns
the *same* Set when nothing changed, which is what lets `LiveGrid` call it
from an effect on every clip-map change without looping.

In selection mode a card tile renders as a `<button>`, not a `<Link>` with
the navigation cancelled — an anchor that sometimes navigates and sometimes
does not breaks middle-click, keyboard and "open in new tab". Footer filter
links are dropped while selecting, so a stray click cannot navigate away and
silently discard a selection.

Confirmation is inline and two-step, not `window.confirm`, which blocks the
page and cannot be styled. Changing the selection cancels a confirmation
already on screen, so the button can never say "Delete 2" and delete 3.

## The risk being accepted

Deletion is irreversible, in bulk, with no recovery path. The mitigations are
the admin gate, the two-step confirmation naming the count, and the fact that
`CLIPS_ADMINS` fails closed. There is no undo and nothing on disk to restore
from. This was chosen knowingly over a retention window.

## Verification

Recorded in `docs/DEPLOYMENT.md` under "Clip deletion (0.1.1)", including the
list of behaviours that still need a browser.
