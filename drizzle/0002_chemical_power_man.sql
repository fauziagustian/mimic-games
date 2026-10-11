CREATE TABLE `community_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`category_id` text NOT NULL,
	`language` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`data` text NOT NULL,
	`audio_key` text NOT NULL,
	`sound_id` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`reviewer` text,
	`review_note` text DEFAULT '' NOT NULL,
	`action_token` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`language`) REFERENCES `languages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sound_id`) REFERENCES `sounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_request` ON `community_submissions` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `community_sound` ON `community_submissions` (`sound_id`);--> statement-breakpoint
CREATE INDEX `community_owner_created` ON `community_submissions` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `community_status_created` ON `community_submissions` (`status`,`created_at`);