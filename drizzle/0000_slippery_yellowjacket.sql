CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`authentik_username` text NOT NULL,
	`email` text,
	`display_name` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_authentik_username_unique` ON `users` (`authentik_username`);