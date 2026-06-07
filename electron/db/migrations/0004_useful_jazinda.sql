ALTER TABLE `task_projects` ADD `identifier` text NOT NULL;--> statement-breakpoint
ALTER TABLE `task_projects` ADD `sequence_counter` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `sequence_id` integer DEFAULT 0 NOT NULL;