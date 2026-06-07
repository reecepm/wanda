CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`pod_id` text,
	`provider_id` text NOT NULL,
	`cwd` text NOT NULL,
	`title` text,
	`title_source` text DEFAULT 'auto' NOT NULL,
	`capabilities` text NOT NULL,
	`modes` text DEFAULT '[]' NOT NULL,
	`model_options` text DEFAULT '[]' NOT NULL,
	`current_mode_id` text,
	`current_model_id` text,
	`persistence_handle` text,
	`state` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`last_event_seq` integer,
	`last_event_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_sessions_workspace_id_idx` ON `chat_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `chat_sessions_pod_id_idx` ON `chat_sessions` (`pod_id`);--> statement-breakpoint
CREATE INDEX `chat_sessions_provider_id_idx` ON `chat_sessions` (`provider_id`);--> statement-breakpoint
CREATE INDEX `chat_sessions_workspace_lastactive_idx` ON `chat_sessions` (`workspace_id`,`archived_at`,`last_event_at`);