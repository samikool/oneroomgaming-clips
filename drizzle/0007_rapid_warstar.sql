ALTER TABLE `games` ADD `igdb_id` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `cover_path` text;--> statement-breakpoint
CREATE UNIQUE INDEX `games_igdb_id_unique` ON `games` (`igdb_id`);