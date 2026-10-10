CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`round` integer NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category_id` text NOT NULL,
	`sound_id` text NOT NULL,
	`language` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`score` integer,
	`data` text NOT NULL,
	`audio_key` text NOT NULL,
	`audio_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`reviewer` text,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_once` ON `attempts` (`match_id`,`round`,`user_id`);--> statement-breakpoint
CREATE INDEX `attempt_review` ON `attempts` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `attempt_leaderboard` ON `attempts` (`version`,`status`,`category_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `attempt_user_created` ON `attempts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `languages` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`code` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `matches_host_created` ON `matches` (`host_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`peer_id` text NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_match_user` ON `members` (`match_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_match_peer` ON `members` (`match_id`,`peer_id`);--> statement-breakpoint
CREATE TABLE `rules` (
	`version` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sounds` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`language` text NOT NULL,
	`data` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`language`) REFERENCES `languages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sounds_filter` ON `sounds` (`active`,`category_id`,`language`);