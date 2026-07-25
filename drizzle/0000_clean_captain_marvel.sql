CREATE TABLE `city_search_cache` (
	`query` text PRIMARY KEY NOT NULL,
	`results_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`telegram_id` integer PRIMARY KEY NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`last_name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_at` text,
	`approved_by` integer,
	`home_city` text,
	`home_country` text,
	`home_country_code` text,
	`home_lat` real,
	`home_lng` real
);
--> statement-breakpoint
CREATE INDEX `members_status_idx` ON `members` (`status`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_id` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`city` text NOT NULL,
	`country` text NOT NULL,
	`country_code` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`telegram_id`) REFERENCES `members`(`telegram_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plans_member_idx` ON `plans` (`telegram_id`);--> statement-breakpoint
CREATE INDEX `plans_dates_idx` ON `plans` (`starts_on`,`ends_on`);