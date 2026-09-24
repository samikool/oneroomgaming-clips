# Milestone 3: Resumable uploads

Scope: browser uploads only; stop before milestone 4's shared realtime UI.

## Implementation

- Use @tus/server 2.4.5, @tus/file-store 2.1.1 and tus-js-client 4.3.1.
  The maintained tus server supports Next App Router's web Request/Response API.
- Authenticated, same-origin /api/uploads endpoint. Validate video filename,
  fixed positive length and metadata; derive uploader from Authentik, never
  trust client-supplied ownership. Enforce ownership on HEAD/PATCH/DELETE.
- Store incomplete data in incoming/.uploads (outside the folder scanner and
  Caddy routes). Completion links the data to incoming/<id>.mp4 and creates
  the clip/probe job atomically in SQLite, preserving title and uploader.
  Reuse the upload ID as clip ID so retries cannot duplicate clips. Retain
  tus data for seven days so a lost final response can resume with HEAD.
  Hard links avoid copying multi-GB files; both paths are on the media mount.
- On startup and periodically, reconcile completed uploads missed by a crash.
  Remove expired staging files under the same lock as writes. No upload table.
- Upload page: multiple file selection/drop, editable titles, 16 MiB chunks,
  progress, pause/resume, retry, cancel. Select the same file after reload to
  resume; fingerprint includes user identity. Refresh processing status by
  polling this page until terminal (shared websocket updates are milestone 4).
- Small authenticated status endpoint returns only display fields. Do not
  send internal paths or full database rows to the browser.

## UI plan

Retain the existing quiet dark library and make clip thumbnails the focus.
Palette: background #0b0d10, panels #14181d, ink #e6e9ee, muted #9aa4b2,
action blue #93c5fd, error rose #fda4af. System sans-serif for UI; tabular
numerals for byte progress. Left-aligned content, readable lines, native
focusable controls; no decorative animations.

Library: [One Room Gaming / Clips]                 [Upload clips] [account]
Upload:  [Back to clips] / Upload clips
         [Choose videos or drop them here]
         [filename / editable title / progress / Pause / Cancel]

Review against brief: a straightforward friend-group video library, not a
marketing page. Keep the grid; avoid a dashboard, fake activity, or theater
controls before their milestone.

## Verification

- Existing suite and production Docker build.
- tus HTTP integration: interrupted upload and resume after service recreation,
  wrong offset, owner isolation, missing auth, forged metadata, invalid file,
  repeated completion, expired cleanup, pipeline handoff with real MP4.
- Browser: upload, pause/resume, processing-to-ready, playback, keyboard and
  narrow viewport; screenshot evidence under output/playwright.
- Deploy using existing Compose service and preserved rollback image/database.

References: https://github.com/tus/tus-node-server/tree/main/packages/server
and the installed Next.js version's node_modules/next/dist/docs.
