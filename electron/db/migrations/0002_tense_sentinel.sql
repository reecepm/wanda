CREATE TABLE `agent_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`agent_type` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_configs_scope_idx` ON `agent_configs` (`scope`,`scope_id`,`agent_type`);--> statement-breakpoint
CREATE INDEX `agent_configs_scope_id_idx` ON `agent_configs` (`scope_id`);