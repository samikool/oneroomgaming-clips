CREATE TABLE `collection_clips` (
	`collection_id` text NOT NULL,
	`clip_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `clip_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collection_clips_order_idx` ON `collection_clips` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`open` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collections_owner_idx` ON `collections` (`owner_id`);--> statement-breakpoint
CREATE INDEX `collections_updated_idx` ON `collections` (`updated_at`);