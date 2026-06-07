CREATE TABLE `auth_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`session_token` text NOT NULL,
	`role` text NOT NULL,
	`device_name` text NOT NULL,
	`device_os` text NOT NULL,
	`device_app_version` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_session_token_unique` ON `auth_sessions` (`session_token`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);