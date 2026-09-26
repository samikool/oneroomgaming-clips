ALTER TABLE `clips` ADD `fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `clips_fingerprint_idx` ON `clips` (`fingerprint`);