PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`sequence_id` integer,
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
	FOREIGN KEY (`project_id`) REFERENCES `task_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "sequence_id", "parent_id", "title", "description", "content", "type", "status", "origin", "assignable", "priority", "labels", "depends_on", "claimed_by", "claimed_at", "lease_expires_at", "context", "version", "created_by", "created_at", "updated_at", "completed_at", "archived_at") SELECT "id", "project_id", "sequence_id", "parent_id", "title", "description", "content", "type", "status", "origin", "assignable", "priority", "labels", "depends_on", "claimed_by", "claimed_at", "lease_expires_at", "context", "version", "created_by", "created_at", "updated_at", "completed_at", "archived_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tasks_project_id_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_priority_idx` ON `tasks` (`priority`);--> statement-breakpoint
CREATE INDEX `tasks_parent_id_idx` ON `tasks` (`parent_id`);