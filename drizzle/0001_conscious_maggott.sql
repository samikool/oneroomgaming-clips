CREATE TABLE `clip_participants` (
	`clip_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`clip_id`, `user_id`),
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clip_participants_user_idx` ON `clip_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `clip_tags` (
	`clip_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`clip_id`, `tag_id`),
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clip_tags_tag_idx` ON `clip_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `clips` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`original_filename` text NOT NULL,
	`uploader_id` text,
	`game_id` text,
	`status` text NOT NULL,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`video_codec` text,
	`audio_codec` text,
	`size_bytes` integer,
	`recorded_at` integer,
	`thumb_path` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clips_created_at_idx` ON `clips` (`created_at`);--> statement-breakpoint
CREATE INDEX `clips_status_idx` ON `clips` (`status`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`clip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`position_ms` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_clip_created_idx` ON `comments` (`clip_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_slug_unique` ON `games` (`slug`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`clip_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_status_created_at_idx` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` text PRIMARY KEY NOT NULL,
	`clip_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`container` text,
	`video_codec` text,
	`audio_codec` text,
	`width` integer,
	`height` integer,
	`bitrate` integer,
	`size_bytes` integer,
	`is_default` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`clip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
