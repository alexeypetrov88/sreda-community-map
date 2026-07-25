CREATE TABLE `admin_claims` (
	`username` text PRIMARY KEY NOT NULL,
	`telegram_id` integer NOT NULL,
	`claimed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "admin_claims_username_check" CHECK(length("admin_claims"."username") BETWEEN 5 AND 32)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_claims_telegram_id_idx` ON `admin_claims` (`telegram_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `admin_claims` (`username`, `telegram_id`)
SELECT lower(`username`), `telegram_id`
FROM `members`
WHERE `status` = 'approved'
  AND `approved_by` = `telegram_id`
  AND `username` IS NOT NULL
  AND length(`username`) BETWEEN 5 AND 32;
