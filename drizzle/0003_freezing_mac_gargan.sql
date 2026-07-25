CREATE TABLE `admin_decision_messages` (
	`request_id` text NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`request_id`, `chat_id`, `message_id`),
	FOREIGN KEY (`request_id`) REFERENCES `membership_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `admin_decision_messages_request_idx` ON `admin_decision_messages` (`request_id`);