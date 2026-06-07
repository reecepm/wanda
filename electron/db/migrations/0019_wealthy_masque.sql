CREATE TABLE `plan_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`anchor` text,
	`author_kind` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`include_in_feedback` integer DEFAULT false NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_comments_plan_idx` ON `plan_comments` (`plan_id`);--> statement-breakpoint
CREATE INDEX `plan_comments_plan_anchor_idx` ON `plan_comments` (`plan_id`,`anchor`);--> statement-breakpoint
CREATE TABLE `plan_links` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_links_plan_idx` ON `plan_links` (`plan_id`);--> statement-breakpoint
CREATE INDEX `plan_links_kind_ref_idx` ON `plan_links` (`kind`,`ref_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_links_plan_kind_ref_unique` ON `plan_links` (`plan_id`,`kind`,`ref_id`);--> statement-breakpoint
CREATE TABLE `plan_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`parent_revision_id` text,
	`author_kind` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_revisions_plan_idx` ON `plan_revisions` (`plan_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text DEFAULT 'prd' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`stale_after_days` integer,
	`last_human_review_at` integer,
	`submitted_by_chat_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plans_workspace_idx` ON `plans` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `plans_workspace_status_idx` ON `plans` (`workspace_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `plans_workspace_slug_unique` ON `plans` (`workspace_id`,`slug`);