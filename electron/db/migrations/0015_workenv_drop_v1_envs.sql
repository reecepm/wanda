CREATE TABLE `workenv_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workenv_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workenv_id`) REFERENCES `workenvs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workenv_events_workenv_id_idx` ON `workenv_events` (`workenv_id`);--> statement-breakpoint
CREATE INDEX `workenv_events_workenv_id_type_idx` ON `workenv_events` (`workenv_id`,`type`);--> statement-breakpoint
CREATE INDEX `workenv_events_created_at_idx` ON `workenv_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `workenv_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`runtime` text NOT NULL,
	`config` text NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workenvs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`worktree_path` text NOT NULL,
	`runtime` text NOT NULL,
	`adapter_handle` text,
	`state` text DEFAULT 'creating' NOT NULL,
	`config_hash` text NOT NULL,
	`config` text NOT NULL,
	`runtime_state` text,
	`resolved_ports` text,
	`template_id` text,
	`last_error` text,
	`last_healthy_at` integer,
	`last_started_at` integer,
	`last_stopped_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `workenv_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workenvs_runtime_idx` ON `workenvs` (`runtime`);--> statement-breakpoint
CREATE INDEX `workenvs_state_idx` ON `workenvs` (`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `workenvs_runtime_handle_unique` ON `workenvs` (`runtime`,`adapter_handle`);--> statement-breakpoint
DROP TABLE `dependencies`;--> statement-breakpoint
DROP TABLE `environment_builds`;--> statement-breakpoint
DROP TABLE `environment_dependencies`;--> statement-breakpoint
DROP TABLE `environment_slices`;--> statement-breakpoint
DROP TABLE `environments`;--> statement-breakpoint
DROP TABLE `profiles`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pods` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`cwd` text NOT NULL,
	`shell` text,
	`env` text,
	`status` text DEFAULT 'stopped' NOT NULL,
	`workenv_id` text,
	`runtime` text,
	`container_id` text,
	`resolved_ports` text,
	`detected_ports` text,
	`container_lifecycle` text DEFAULT 'inherit' NOT NULL,
	`slice_branch` text,
	`git_context` text,
	`active_view_id` text,
	`is_template` integer DEFAULT false NOT NULL,
	`template_description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workenv_id`) REFERENCES `workenvs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_pods`("id", "workspace_id", "name", "cwd", "shell", "env", "status", "runtime", "container_id", "resolved_ports", "detected_ports", "container_lifecycle", "slice_branch", "git_context", "active_view_id", "is_template", "template_description", "sort_order", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "cwd", "shell", "env", "status", "runtime", "container_id", "resolved_ports", "detected_ports", "container_lifecycle", "slice_branch", "git_context", "active_view_id", "is_template", "template_description", "sort_order", "created_at", "updated_at" FROM `pods`;--> statement-breakpoint
DROP TABLE `pods`;--> statement-breakpoint
ALTER TABLE `__new_pods` RENAME TO `pods`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `pods_workspace_id_idx` ON `pods` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `pods_status_idx` ON `pods` (`status`);--> statement-breakpoint
CREATE INDEX `pods_is_template_idx` ON `pods` (`is_template`);--> statement-breakpoint
CREATE INDEX `pods_workenv_id_idx` ON `pods` (`workenv_id`);--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cwd` text DEFAULT '' NOT NULL,
	`repo_path` text,
	`active_workspace_view_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "name", "cwd", "repo_path", "active_workspace_view_id", "sort_order", "created_at", "updated_at") SELECT "id", "name", "cwd", "repo_path", "active_workspace_view_id", "sort_order", "created_at", "updated_at" FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;