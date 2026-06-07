CREATE TABLE `permission_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`tool_kind` text NOT NULL,
	`tool_name` text DEFAULT '*' NOT NULL,
	`location_pattern` text DEFAULT '**' NOT NULL,
	`decision` text NOT NULL,
	`created_by_session_id` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permission_policies_key_unique` ON `permission_policies` (`workspace_id`,`provider_id`,`tool_kind`,`tool_name`,`location_pattern`);--> statement-breakpoint
CREATE INDEX `permission_policies_resolve_idx` ON `permission_policies` (`workspace_id`,`provider_id`,`tool_kind`);
