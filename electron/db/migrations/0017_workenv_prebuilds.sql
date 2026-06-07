CREATE TABLE IF NOT EXISTS `workenv_prebuilds` (
	`id` text PRIMARY KEY NOT NULL,
	`runtime` text NOT NULL,
	`config_hash` text NOT NULL,
	`adapter_handle` text,
	`state` text NOT NULL,
	`config` text NOT NULL,
	`runtime_state` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `workenv_prebuilds_runtime_idx` ON `workenv_prebuilds` (`runtime`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `workenv_prebuilds_state_idx` ON `workenv_prebuilds` (`state`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `workenv_prebuilds_runtime_handle_unique` ON `workenv_prebuilds` (`runtime`,`adapter_handle`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `workenvs_slug_unique` ON `workenvs` (`slug`);
