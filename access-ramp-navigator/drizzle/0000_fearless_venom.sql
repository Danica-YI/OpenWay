CREATE TABLE `accessibility_contributions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`building_id` text NOT NULL,
	`category` text NOT NULL,
	`location` text NOT NULL,
	`details` text NOT NULL,
	`contributor` text DEFAULT 'Community member' NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
