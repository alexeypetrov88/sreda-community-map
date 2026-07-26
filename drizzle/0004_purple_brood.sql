PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_members` (
	`telegram_id` integer PRIMARY KEY NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`last_name` text,
	`display_name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_at` text,
	`approved_by` integer,
	`status_changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`home_place_id` text,
	FOREIGN KEY (`home_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "members_status_check" CHECK("__new_members"."status" IN ('pending','approved','rejected','revoked','blocked')),
	CONSTRAINT "members_first_name_check" CHECK(length("__new_members"."first_name") BETWEEN 1 AND 100),
	CONSTRAINT "members_last_name_check" CHECK("__new_members"."last_name" IS NULL OR length("__new_members"."last_name") <= 100),
	CONSTRAINT "members_display_name_check" CHECK("__new_members"."display_name" IS NULL OR length("__new_members"."display_name") BETWEEN 1 AND 100),
	CONSTRAINT "members_username_check" CHECK("__new_members"."username" IS NULL OR length("__new_members"."username") <= 64)
);
--> statement-breakpoint
INSERT INTO `__new_members`("telegram_id", "username", "first_name", "last_name", "display_name", "status", "requested_at", "approved_at", "approved_by", "status_changed_at", "home_place_id")
SELECT
	"telegram_id",
	"username",
	"first_name",
	"last_name",
	substr(
		trim(
			"first_name" ||
			CASE
				WHEN "last_name" IS NOT NULL AND trim("last_name") <> ''
					THEN ' ' || "last_name"
				ELSE ''
			END
		),
		1,
		100
	),
	"status",
	"requested_at",
	"approved_at",
	"approved_by",
	"status_changed_at",
	"home_place_id"
FROM `members`;--> statement-breakpoint
DROP TABLE `members`;--> statement-breakpoint
ALTER TABLE `__new_members` RENAME TO `members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `members_status_idx` ON `members` (`status`);
