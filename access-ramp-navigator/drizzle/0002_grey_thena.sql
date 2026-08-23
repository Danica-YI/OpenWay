CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `accessibility_contributions` ADD `building_name` text;--> statement-breakpoint
ALTER TABLE `accessibility_contributions` ADD `user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `accessibility_contributions` ADD `anonymous` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `contribution_user_idx` ON `accessibility_contributions` (`user_id`,`created_at`);