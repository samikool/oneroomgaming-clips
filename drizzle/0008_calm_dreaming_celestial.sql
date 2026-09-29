ALTER TABLE `clips` ADD `people_notified` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `clips` SET `people_notified` = 1;
