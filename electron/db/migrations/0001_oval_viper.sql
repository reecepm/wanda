CREATE TABLE `file_review_markers` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`file_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_review_markers_pod_file_unique` ON `file_review_markers` (`pod_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `file_review_markers_pod_id_idx` ON `file_review_markers` (`pod_id`);--> statement-breakpoint
ALTER TABLE `workspace_settings` ADD `auto_generated_globs` text;