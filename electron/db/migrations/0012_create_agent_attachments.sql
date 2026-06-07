CREATE TABLE `agent_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`original_filename` text,
	`source` text NOT NULL,
	`first_referenced_turn_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_attachments_session_id_idx` ON `agent_attachments` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_attachments_session_sha_idx` ON `agent_attachments` (`session_id`,`sha256`);