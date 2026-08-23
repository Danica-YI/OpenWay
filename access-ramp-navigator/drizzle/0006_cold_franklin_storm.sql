CREATE TABLE `contribution_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contribution_id` integer NOT NULL,
	`user_id` integer,
	`reason` text NOT NULL,
	`details` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contribution_id`) REFERENCES `accessibility_contributions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `report_contribution_idx` ON `contribution_reports` (`contribution_id`);