DROP TABLE `targets`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pods` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`cwd` text NOT NULL,
	`shell` text,
	`env` text,
	`status` text DEFAULT 'stopped' NOT NULL,
	`environment_id` text,
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
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_pods`("id", "workspace_id", "name", "cwd", "shell", "env", "status", "environment_id", "runtime", "container_id", "resolved_ports", "detected_ports", "container_lifecycle", "slice_branch", "git_context", "active_view_id", "is_template", "template_description", "sort_order", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "cwd", "shell", "env", "status", "environment_id", "runtime", "container_id", "resolved_ports", "detected_ports", "container_lifecycle", "slice_branch", "git_context", "active_view_id", "is_template", "template_description", "sort_order", "created_at", "updated_at" FROM `pods`;--> statement-breakpoint
DROP TABLE `pods`;--> statement-breakpoint
ALTER TABLE `__new_pods` RENAME TO `pods`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `pods_workspace_id_idx` ON `pods` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `pods_status_idx` ON `pods` (`status`);--> statement-breakpoint
CREATE INDEX `pods_is_template_idx` ON `pods` (`is_template`);--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cwd` text DEFAULT '' NOT NULL,
	`repo_path` text,
	`environment_id` text,
	`active_workspace_view_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "name", "cwd", "repo_path", "environment_id", "active_workspace_view_id", "sort_order", "created_at", "updated_at") SELECT "id", "name", "cwd", "repo_path", "environment_id", "active_workspace_view_id", "sort_order", "created_at", "updated_at" FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;--> statement-breakpoint
ALTER TABLE `environment_builds` DROP COLUMN `target_id`;--> statement-breakpoint
ALTER TABLE `environment_slices` DROP COLUMN `target_id`;