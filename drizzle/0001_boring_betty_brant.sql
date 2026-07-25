CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`actor_telegram_id` integer,
	`target_telegram_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "audit_events_type_check" CHECK(length("audit_events"."type") BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_target_idx` ON `audit_events` (`target_telegram_id`);--> statement-breakpoint
CREATE TABLE `membership_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`decided_at` text,
	`decided_by` integer,
	FOREIGN KEY (`telegram_id`) REFERENCES `members`(`telegram_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "membership_requests_status_check" CHECK("membership_requests"."status" IN ('pending','approved','rejected','expired'))
);
--> statement-breakpoint
CREATE INDEX `membership_requests_member_idx` ON `membership_requests` (`telegram_id`);--> statement-breakpoint
CREATE INDEX `membership_requests_status_idx` ON `membership_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_requests_one_pending_idx` ON `membership_requests` (`telegram_id`) WHERE "membership_requests"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_key` text NOT NULL,
	`city` text NOT NULL,
	`country` text NOT NULL,
	`country_code` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "places_id_check" CHECK(length("places"."id") BETWEEN 16 AND 64),
	CONSTRAINT "places_city_check" CHECK(length("places"."city") BETWEEN 1 AND 100),
	CONSTRAINT "places_country_check" CHECK(length("places"."country") BETWEEN 1 AND 100),
	CONSTRAINT "places_country_code_check" CHECK(length("places"."country_code") = 2),
	CONSTRAINT "places_lat_check" CHECK("places"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "places_lng_check" CHECK("places"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `places_canonical_key_idx` ON `places` (`canonical_key`);--> statement-breakpoint
INSERT INTO `places` (
	`id`, `canonical_key`, `city`, `country`, `country_code`, `lat`, `lng`
)
SELECT
	printf('legacy-home-%016d', `telegram_id`),
	'legacy-home:' || `telegram_id`,
	substr(`home_city`, 1, 100),
	substr(`home_country`, 1, 100),
	upper(`home_country_code`),
	`home_lat`,
	`home_lng`
FROM `members`
WHERE `home_city` IS NOT NULL
	AND `home_country` IS NOT NULL
	AND length(`home_country_code`) = 2
	AND `home_lat` BETWEEN -90 AND 90
	AND `home_lng` BETWEEN -180 AND 180;--> statement-breakpoint
INSERT INTO `places` (
	`id`, `canonical_key`, `city`, `country`, `country_code`, `lat`, `lng`
)
SELECT
	'legacy-plan-' || replace(`id`, '-', ''),
	'legacy-plan:' || `id`,
	substr(`city`, 1, 100),
	substr(`country`, 1, 100),
	upper(`country_code`),
	`lat`,
	`lng`
FROM `plans`;--> statement-breakpoint
CREATE TABLE `rate_limit_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`processed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_members` (
	`telegram_id` integer PRIMARY KEY NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`last_name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_at` text,
	`approved_by` integer,
	`status_changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`home_place_id` text,
	FOREIGN KEY (`home_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "members_status_check" CHECK("status" IN ('pending','approved','rejected','revoked','blocked')),
	CONSTRAINT "members_first_name_check" CHECK(length("first_name") BETWEEN 1 AND 100),
	CONSTRAINT "members_last_name_check" CHECK("last_name" IS NULL OR length("last_name") <= 100),
	CONSTRAINT "members_username_check" CHECK("username" IS NULL OR length("username") <= 64)
);
--> statement-breakpoint
INSERT INTO `__new_members`(
	"telegram_id", "username", "first_name", "last_name", "status",
	"requested_at", "approved_at", "approved_by", "status_changed_at",
	"home_place_id"
)
SELECT
	"telegram_id",
	substr("username", 1, 64),
	substr("first_name", 1, 100),
	substr("last_name", 1, 100),
	"status",
	"requested_at",
	"approved_at",
	"approved_by",
	coalesce("approved_at", "requested_at", CURRENT_TIMESTAMP),
	CASE
		WHEN "status" = 'approved'
			AND "home_city" IS NOT NULL
			AND "home_country" IS NOT NULL
			AND length("home_country_code") = 2
			AND "home_lat" BETWEEN -90 AND 90
			AND "home_lng" BETWEEN -180 AND 180
		THEN printf('legacy-home-%016d', "telegram_id")
		ELSE NULL
	END
FROM `members`;--> statement-breakpoint
DROP TABLE `members`;--> statement-breakpoint
ALTER TABLE `__new_members` RENAME TO `members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `members_status_idx` ON `members` (`status`);--> statement-breakpoint
CREATE TABLE `__new_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_id` integer NOT NULL,
	`place_id` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`telegram_id`) REFERENCES `members`(`telegram_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plans_dates_check" CHECK("starts_on" <= "ends_on")
);
--> statement-breakpoint
INSERT INTO `__new_plans`(
	"id", "telegram_id", "place_id", "starts_on", "ends_on", "created_at"
)
SELECT
	"id",
	"telegram_id",
	'legacy-plan-' || replace("id", '-', ''),
	"starts_on",
	"ends_on",
	"created_at"
FROM `plans`
WHERE `telegram_id` IN (
	SELECT `telegram_id` FROM `members` WHERE `status` = 'approved'
);--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
ALTER TABLE `__new_plans` RENAME TO `plans`;--> statement-breakpoint
CREATE INDEX `plans_member_idx` ON `plans` (`telegram_id`);--> statement-breakpoint
CREATE INDEX `plans_dates_idx` ON `plans` (`starts_on`,`ends_on`);--> statement-breakpoint
CREATE TRIGGER `plans_no_overlap_before_insert`
BEFORE INSERT ON `plans`
WHEN EXISTS (
	SELECT 1
	FROM `plans`
	WHERE `telegram_id` = NEW.`telegram_id`
		AND `starts_on` <= NEW.`ends_on`
		AND `ends_on` >= NEW.`starts_on`
)
BEGIN
	SELECT RAISE(ABORT, 'overlapping plan');
END;--> statement-breakpoint
DELETE FROM `places`
WHERE `id` LIKE 'legacy-%'
	AND `id` NOT IN (
		SELECT `home_place_id` FROM `members` WHERE `home_place_id` IS NOT NULL
	)
	AND `id` NOT IN (SELECT `place_id` FROM `plans`);
