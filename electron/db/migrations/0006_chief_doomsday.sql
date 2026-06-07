CREATE TABLE `review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`file_path` text NOT NULL,
	`side` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer,
	`anchor_content` text,
	`anchor_hash` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_comments_review_idx` ON `review_comments` (`review_id`);--> statement-breakpoint
CREATE INDEX `review_comments_review_file_idx` ON `review_comments` (`review_id`,`file_path`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`base_ref` text,
	`head_commit` text,
	`summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_at` integer,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_pod_id_idx` ON `reviews` (`pod_id`);--> statement-breakpoint
CREATE INDEX `reviews_pod_state_idx` ON `reviews` (`pod_id`,`state`);