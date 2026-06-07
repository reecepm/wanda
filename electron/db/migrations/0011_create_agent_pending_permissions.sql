CREATE TABLE `agent_pending_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`event_seq` integer NOT NULL,
	`request` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolution` text,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_pending_permissions_session_idx` ON `agent_pending_permissions` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_pending_permissions_unresolved_idx` ON `agent_pending_permissions` (`resolved_at`);