CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `takes` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`round` integer NOT NULL,
	`user_id` text NOT NULL,
	`data` text NOT NULL,
	`audio_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `take_once` ON `takes` (`match_id`,`round`,`user_id`);