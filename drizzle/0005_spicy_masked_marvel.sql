CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`user_id` text NOT NULL,
	`clip_id` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_clip_at_idx` ON `activity` (`clip_id`,`at`);--> statement-breakpoint
CREATE INDEX `activity_at_idx` ON `activity` (`at`);--> statement-breakpoint
CREATE INDEX `activity_user_at_idx` ON `activity` (`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `likes` (
	`user_id` text NOT NULL,
	`clip_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `clip_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `likes_clip_idx` ON `likes` (`clip_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`type` text NOT NULL,
	`clip_id` text NOT NULL,
	`comment_id` text,
	`actors` text NOT NULL,
	`position_ms` integer,
	`source` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_id`,`read_at`,`updated_at`);--> statement-breakpoint
DROP TABLE `views`;--> statement-breakpoint
ALTER TABLE `users` ADD `visit_started_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `previous_visit_at` integer;