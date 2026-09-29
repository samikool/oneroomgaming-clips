import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  authentikUsername: text("authentik_username").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  // 0.4.0 profiles. All nullable: every fallback is resolved in profiles.ts.
  profileName: text("profile_name"),
  accent: text("accent"),
  bio: text("bio"),
  pictureVersion: integer("picture_version"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  // 0.4.0 "since you were last here": the current visit and the one before it.
  visitStartedAt: integer("visit_started_at", { mode: "timestamp_ms" }),
  previousVisitAt: integer("previous_visit_at", { mode: "timestamp_ms" }),
});

export type User = typeof users.$inferSelect;

export type ClipStatus =
  | "pending"
  | "processing"
  /** A pipeline job failed and is waiting out its backoff before another try. */
  | "retrying"
  | "ready"
  | "needs_transcode"
  | "failed";

export type JobType = "probe" | "thumbnail" | "remux" | "transcode";
export type JobStatus = "queued" | "running" | "done" | "failed";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Null for free-text games. One local game per IGDB entry. */
  igdbId: integer("igdb_id").unique(),
  /** Filename under MEDIA_ROOT/covers; null until a cover is downloaded. */
  coverPath: text("cover_path"),
});

export const clips = sqliteTable(
  "clips",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    originalFilename: text("original_filename").notNull(),
    uploaderId: text("uploader_id").references(() => users.id),
    gameId: text("game_id").references(() => games.id),
    status: text("status").$type<ClipStatus>().notNull(),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    sizeBytes: integer("size_bytes"),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }),
    thumbPath: text("thumb_path"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /**
     * SHA-256 of the file's size, first MiB and last MiB, computed by the
     * uploading browser. One clip per fingerprint, across everyone. Null for
     * clips from before 0.3.5 and for folder-ingested ones; SQLite lets any
     * number of NULLs share a unique index.
     */
    fingerprint: text("fingerprint"),
    /** One "tagged" pass happens when the clip first becomes ready. */
    peopleNotified: integer("people_notified", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("clips_created_at_idx").on(t.createdAt),
    index("clips_status_idx").on(t.status),
    uniqueIndex("clips_fingerprint_idx").on(t.fingerprint),
  ],
);

export const mediaFiles = sqliteTable("media_files", {
  id: text("id").primaryKey(),
  clipId: text("clip_id").notNull().references(() => clips.id),
  kind: text("kind").notNull(),
  path: text("path").notNull(),
  container: text("container"),
  videoCodec: text("video_codec"),
  audioCodec: text("audio_codec"),
  width: integer("width"),
  height: integer("height"),
  bitrate: integer("bitrate"),
  sizeBytes: integer("size_bytes"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const clipTags = sqliteTable(
  "clip_tags",
  {
    clipId: text("clip_id").notNull().references(() => clips.id),
    tagId: text("tag_id").notNull().references(() => tags.id),
  },
  (t) => [
    primaryKey({ columns: [t.clipId, t.tagId] }),
    index("clip_tags_tag_idx").on(t.tagId),
  ],
);

export const clipParticipants = sqliteTable(
  "clip_participants",
  {
    clipId: text("clip_id").notNull().references(() => clips.id),
    userId: text("user_id").notNull().references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.clipId, t.userId] }),
    index("clip_participants_user_idx").on(t.userId),
  ],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    clipId: text("clip_id").notNull().references(() => clips.id),
    userId: text("user_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    positionMs: integer("position_ms"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("comments_clip_created_idx").on(t.clipId, t.createdAt)],
);

export type ActivityType = "view" | "comment" | "reaction" | "theater_play";

/** What people did with a clip. The source of truth for Trending and Top. */
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    type: text("type").$type<ActivityType>().notNull(),
    /** The actor; the host for `theater_play`. */
    userId: text("user_id").notNull().references(() => users.id),
    clipId: text("clip_id").notNull().references(() => clips.id),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("activity_clip_at_idx").on(t.clipId, t.at),
    index("activity_at_idx").on(t.at),
    index("activity_user_at_idx").on(t.userId, t.at),
  ],
);

/** Current state, not history: a like can be undone. */
export const likes = sqliteTable(
  "likes",
  {
    userId: text("user_id").notNull().references(() => users.id),
    clipId: text("clip_id").notNull().references(() => clips.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.clipId] }), index("likes_clip_idx").on(t.clipId, t.createdAt)],
);

export type NotificationType = "like" | "comment" | "participant_comment" | "tagged" | "tagged_bulk" | "mention";

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id").notNull().references(() => users.id),
    type: text("type").$type<NotificationType>().notNull(),
    clipId: text("clip_id").notNull().references(() => clips.id),
    commentId: text("comment_id").references(() => comments.id),
    /** JSON array of usernames, most recent first. */
    actors: text("actors").notNull(),
    positionMs: integer("position_ms"),
    source: text("source").$type<"comment" | "chat">(),
    /** tagged_bulk only: how many clips. */
    count: integer("count"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("notifications_recipient_idx").on(t.recipientId, t.readAt, t.updatedAt)],
);

/** A named list of clips. Visible to everyone; `open` lets anyone add. */
export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    open: integer("open", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** Bumped on every change, including clip add, remove and reorder. */
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("collections_owner_idx").on(t.ownerId), index("collections_updated_idx").on(t.updatedAt)],
);

/** Membership, in order. `position` is 0-based and kept dense. */
export const collectionClips = sqliteTable(
  "collection_clips",
  {
    collectionId: text("collection_id").notNull().references(() => collections.id),
    clipId: text("clip_id").notNull().references(() => clips.id),
    position: integer("position").notNull(),
    addedBy: text("added_by").notNull().references(() => users.id),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.clipId] }),
    index("collection_clips_order_idx").on(t.collectionId, t.position),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    clipId: text("clip_id").notNull().references(() => clips.id),
    type: text("type").$type<JobType>().notNull(),
    status: text("status").$type<JobStatus>().notNull(),
    attempts: integer("attempts").notNull(),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    /** A retried job is not claimed before this; null means straight away. */
    runAfter: integer("run_after", { mode: "timestamp_ms" }),
  },
  (t) => [index("jobs_status_created_at_idx").on(t.status, t.createdAt)],
);

export type Clip = typeof clips.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Game = typeof games.$inferSelect;
