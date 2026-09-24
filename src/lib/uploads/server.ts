import { FileStore } from "@tus/file-store";
import { EVENTS, MemoryLocker, Server, type Upload } from "@tus/server";
import { existsSync, linkSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { ulid } from "ulid";
import { getDb, type Db } from "@/db/client";
import { createClip, getClip } from "@/db/clips";
import { enqueueStage } from "@/db/jobs";
import { upsertUser } from "@/db/users";
import { MissingAuthHeadersError } from "@/lib/auth";
import { resolveIdentity } from "@/lib/session";
import { incomingDir } from "@/lib/media/paths";
import { VIDEO_EXTENSIONS } from "@/lib/ingest/scan";
import { announceClipAdded } from "@/lib/events/clips";
import { publish } from "@/lib/realtime/publish";

export const UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const PATH = "/api/uploads";
const error = (status_code: number, body: string) => ({ status_code, body });

/** Whole-percent upload progress, clamped and NaN-free for an unknown size. */
export function progressPercent(offset: number, size: number | undefined): number {
  if (!size || size <= 0) return 0;
  return Math.min(100, Math.round((offset / size) * 100));
}

export function createUploadService(db: Db, env: NodeJS.ProcessEnv = process.env) {
  const incoming = incomingDir(env);
  const directory = join(incoming, ".uploads");
  mkdirSync(directory, { recursive: true });
  const store = new FileStore({ directory, expirationPeriodInMilliseconds: UPLOAD_TTL_MS });
  const locker = new MemoryLocker();

  // No async gap between checking the clip and committing the handoff. The tus
  // data remains available for HEAD after a lost final response. Hard links use
  // no additional media bytes and stay on the same filesystem as incoming/.
  function finish(upload: Upload): string | undefined {
    if (upload.offset !== upload.size || !upload.size) return undefined;
    if (getClip(db, upload.id)) return undefined;
    const metadata = upload.metadata!;
    const destination = join(incoming, `${upload.id}.mp4`);
    if (!existsSync(destination)) linkSync(join(directory, upload.id), destination);
    db.transaction(() => {
      createClip(db, {
        id: upload.id,
        title: metadata.title!,
        originalFilename: metadata.filename!,
        uploaderId: metadata.uploaderId!,
        sizeBytes: upload.size!,
      });
      enqueueStage(db, upload.id, "probe");
    });

    return upload.id;
  }

  const server: Server = new Server({
    path: PATH,
    datastore: store,
    locker,
    relativeLocation: true,
    // tus throttles POST_RECEIVE for us, so no hand-rolled rate limiting.
    postReceiveInterval: 1000,
    allowedOrigins: [],
    disableTerminationForFinishedUploads: true,
    namingFunction: () => ulid(),
    async onIncomingRequest(req, id) {
      if (req.method === "POST") return;
      if (!ID.test(id)) throw error(404, "Upload not found");
      const upload = await store.getUpload(id);
      const identity = resolveIdentity(req.headers, env);
      if (upload.metadata?.owner !== identity.username) throw error(404, "Upload not found");
    },
    async onUploadCreate(req, upload) {
      const filename = upload.metadata?.filename?.trim();
      if (!filename || filename.length > 255 || /[/\\\x00-\x1f\x7f]/.test(filename)
        || !VIDEO_EXTENSIONS.has(extname(filename).toLowerCase())) {
        throw error(400, "Choose an MP4, MOV, MKV, WebM, or AVI video.");
      }
      if (!Number.isSafeInteger(upload.size) || !upload.size || upload.size < 1) {
        throw error(400, "A non-empty video with a known size is required.");
      }
      const title = upload.metadata?.title?.trim() || basename(filename, extname(filename));
      if (title.length > 200 || /[\x00-\x1f\x7f]/.test(title)) {
        throw error(400, "Use a title of 200 characters or fewer.");
      }
      const user = upsertUser(db, resolveIdentity(req.headers, env));
      // Replace, rather than merge, untrusted metadata.
      return { metadata: { filename, title, owner: user.authentikUsername, uploaderId: user.id } };
    },
    async onUploadFinish(_req, upload) {
      // Announced after finish returns, never inside it: finish is
      // deliberately synchronous so the runner can never observe a clip row
      // whose file is absent, and an await in there would open that gap.
      const created = finish(upload);
      if (created) await announceClipAdded(db, created, env);
      return { headers: { "X-Clip-Id": upload.id } };
    },
    onResponseError(_req, err) {
      if ("status_code" in err && err.status_code < 500) return err;
      console.error("upload request failed", err);
      return error(500, "Upload could not be saved. Retry to resume.");
    },
  });

  // Progress is ephemeral: the hub drops it for a backed-up socket, and a
  // publish failure here must never disturb an upload in flight, so the
  // promise is deliberately not awaited on the request path.
  server.on(EVENTS.POST_RECEIVE, (_stream, upload: Upload) => {
    const owner = upload.metadata?.owner;

    if (!owner) {
      return;
    }

    void publish(
      {
        t: "upload.progress",
        uploadId: upload.id,
        pct: progressPercent(upload.offset, upload.size),
        user: owner,
      },
      env,
    );
  });

  async function handle(req: Request): Promise<Response> {
    try {
      resolveIdentity(req.headers, env);
    } catch (err) {
      if (!(err instanceof MissingAuthHeadersError)) throw err;
      return new Response("Sign in to upload clips.", { status: 401 });
    }
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    let sameOrigin = true;
    try { if (origin) sameOrigin = new URL(origin).host === host; } catch { sameOrigin = false; }
    if (!sameOrigin || req.headers.get("sec-fetch-site") === "cross-site") {
      return new Response("Cross-site uploads are not allowed.", { status: 403 });
    }
    const pathname = new URL(req.url).pathname;
    if (pathname !== PATH && !new RegExp(`^${PATH}/[0-9A-HJKMNP-TV-Z]{26}$`).test(pathname)) {
      return new Response("Upload not found", { status: 404 });
    }
    if ((req.headers.get("upload-metadata")?.length ?? 0) > 8192) {
      return new Response("Upload metadata is too large.", { status: 400 });
    }
    return server.handleWeb(req);
  }

  async function sweep(now = Date.now()) {
    // A single web process owns both the tus locks and this maintenance loop.
    for (const id of await store.configstore.list!()) {
      if (!ID.test(id) || locker.locks.has(id)) continue;
      const lock = locker.newLock(id);
      await lock.lock(new AbortController().signal, () => {});
      try {
        const upload = await store.getUpload(id);
        // Recover a crash after the last byte but before handoff.
        const recovered = finish(upload);
        if (recovered) await announceClipAdded(db, recovered, env);
        if (now > new Date(upload.creation_date!).getTime() + UPLOAD_TTL_MS) {
          await store.remove(id); // Published clip links/renditions are unaffected.
        }
      } catch (err) {
        console.error(`upload maintenance failed for ${id}`, err);
      } finally {
        await lock.unlock();
      }
    }
  }

  return { handle, sweep, store };
}

type UploadService = ReturnType<typeof createUploadService>;
export function getUploadService(): UploadService {
  const state = globalThis as typeof globalThis & { clipsUploads?: UploadService };
  return state.clipsUploads ??= createUploadService(getDb());
}
