import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  authentikUsername: text("authentik_username").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
});

export type User = typeof users.$inferSelect;

export type ClipStatus =
  | "pending"
  | "processing"
  | "ready"
  | "needs_transcode"
  | "failed";

export type JobType = "probe" | "thumbnail" | "remux" | "transcode";
export type JobStatus = "queued" | "running" | "done" | "failed";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
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
  },
  (t) => [
    index("clips_created_at_idx").on(t.createdAt),
    index("clips_status_idx").on(t.status),
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

export const views = sqliteTable("views", {
  id: text("id").primaryKey(),
  clipId: text("clip_id").notNull().references(() => clips.id),
  userId: text("user_id").notNull().references(() => users.id),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
});

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
  },
  (t) => [index("jobs_status_created_at_idx").on(t.status, t.createdAt)],
);

export type Clip = typeof clips.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Game = typeof games.$inferSelect;
