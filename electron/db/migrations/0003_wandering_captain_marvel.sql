CREATE TABLE `task_context_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text,
	`question` text NOT NULL,
	`response` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`auto_blocked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`responded_at` integer,
	`responded_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_context_requests_task_id_idx` ON `task_context_requests` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`entity_id` text,
	`agent_id` text,
	`data` text DEFAULT '{}' NOT NULL,
	`timestamp` integer NOT NULL,
	`instance_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_events_position_idx` ON `task_events` (`position`);--> statement-breakpoint
CREATE INDEX `task_events_type_idx` ON `task_events` (`type`);--> statement-breakpoint
CREATE INDEX `task_events_entity_id_idx` ON `task_events` (`entity_id`);--> statement-breakpoint
CREATE TABLE `task_learnings` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`source_task_id` text,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_learnings_task_id_idx` ON `task_learnings` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_peers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`auth_token` text,
	`enabled` integer DEFAULT true NOT NULL,
	`auto_claimable` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_peers_name_idx` ON `task_peers` (`name`);--> statement-breakpoint
CREATE TABLE `task_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`config` text DEFAULT '{}' NOT NULL,
	`labels` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `task_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_projects_workspace_id_idx` ON `task_projects` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `task_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`config` text DEFAULT '{}' NOT NULL,
	`labels` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`description` text,
	`content` text,
	`type` text DEFAULT 'task' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`origin` text DEFAULT 'human' NOT NULL,
	`assignable` text DEFAULT 'either' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`labels` text DEFAULT '{}' NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`claimed_by` text,
	`claimed_at` integer,
	`lease_expires_at` integer,
	`context` text DEFAULT '{"own":null,"inherited":null}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`archived_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `task_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_project_id_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_priority_idx` ON `tasks` (`priority`);--> statement-breakpoint
CREATE INDEX `tasks_parent_id_idx` ON `tasks` (`parent_id`);--> statement-breakpoint
ALTER TABLE `pods` DROP COLUMN `orca_project_ref`;--> statement-breakpoint
ALTER TABLE `workspaces` DROP COLUMN `orca_ref`;