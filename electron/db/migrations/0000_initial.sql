CREATE TABLE `command_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_tags_pod_name` ON `command_tags` (`pod_id`,`name`);--> statement-breakpoint
CREATE TABLE `dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `environment_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`target_id` text NOT NULL,
	`config_hash` text NOT NULL,
	`image_tag` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`dockerfile` text NOT NULL,
	`build_log` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `environment_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`dependency_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependency_id`) REFERENCES `dependencies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `environment_slices` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`target_id` text NOT NULL,
	`config_hash` text NOT NULL,
	`repo_url` text,
	`branch` text NOT NULL,
	`commit_sha` text NOT NULL,
	`slice_hash` text NOT NULL,
	`image_tag` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`dockerfile` text NOT NULL,
	`build_log` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`profile_ids` text NOT NULL,
	`config_hash` text NOT NULL,
	`resources` text,
	`work_dir` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `launch_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`scope_id` text,
	`terminals` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `node_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`workflow_node_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`execution_layer` integer,
	`resolved_inputs` text,
	`outputs` text,
	`error` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`waiting_port_slugs` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_node_id`) REFERENCES `workflow_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `node_runs_run_id_idx` ON `node_runs` (`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `node_runs_run_node_idx` ON `node_runs` (`workflow_run_id`,`workflow_node_id`);--> statement-breakpoint
CREATE INDEX `node_runs_run_layer_idx` ON `node_runs` (`workflow_run_id`,`execution_layer`);--> statement-breakpoint
CREATE TABLE `node_type_ports` (
	`id` text PRIMARY KEY NOT NULL,
	`node_type_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`direction` text NOT NULL,
	`data_type` text NOT NULL,
	`is_array` integer DEFAULT false NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`default_value` text,
	`description` text,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`node_type_id`) REFERENCES `node_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_type_ports_node_type_id_slug_unique` ON `node_type_ports` (`node_type_id`,`slug`);--> statement-breakpoint
CREATE TABLE `node_types` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`executor_key` text NOT NULL,
	`is_intrinsic` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_types_slug_unique` ON `node_types` (`slug`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`priority` text NOT NULL,
	`pod_id` text,
	`pod_terminal_id` text,
	`workspace_id` text,
	`title` text NOT NULL,
	`body` text,
	`payload` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`resolved_at` integer,
	`resolution` text,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pod_terminal_id`) REFERENCES `pod_terminals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_pod_id_idx` ON `notifications` (`pod_id`);--> statement-breakpoint
CREATE INDEX `notifications_pod_terminal_id_idx` ON `notifications` (`pod_terminal_id`);--> statement-breakpoint
CREATE INDEX `notifications_workspace_id_idx` ON `notifications` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `notifications_unresolved_idx` ON `notifications` (`resolved_at`,`priority`);--> statement-breakpoint
CREATE TABLE `pending_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`node_run_id` text NOT NULL,
	`port_slug` text NOT NULL,
	`prompt` text,
	`data_type` text NOT NULL,
	`is_array` integer DEFAULT false NOT NULL,
	`value` text,
	`provided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_run_id`) REFERENCES `node_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pending_inputs_run_node_idx` ON `pending_inputs` (`workflow_run_id`,`node_run_id`);--> statement-breakpoint
CREATE TABLE `pod_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`pod_terminal_id` text NOT NULL,
	`agent_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pod_terminal_id`) REFERENCES `pod_terminals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pod_agents_pod_id_idx` ON `pod_agents` (`pod_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pod_agents_terminal_idx` ON `pod_agents` (`pod_terminal_id`);--> statement-breakpoint
CREATE TABLE `pod_command_tags` (
	`command_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`command_id`, `tag_id`),
	FOREIGN KEY (`command_id`) REFERENCES `pod_commands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `command_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pct_command_idx` ON `pod_command_tags` (`command_id`);--> statement-breakpoint
CREATE INDEX `pct_tag_idx` ON `pod_command_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `pod_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`directory` text,
	`directory_mode` text DEFAULT 'absolute' NOT NULL,
	`args` text,
	`auto_start` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pod_commands_pod_id_idx` ON `pod_commands` (`pod_id`);--> statement-breakpoint
CREATE TABLE `pod_items` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`content_type` text NOT NULL,
	`label` text NOT NULL,
	`label_source` text DEFAULT 'default' NOT NULL,
	`config` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pod_items_pod_id_idx` ON `pod_items` (`pod_id`);--> statement-breakpoint
CREATE TABLE `pod_terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text,
	`args` text,
	`env` text,
	`restart_policy` text DEFAULT 'never' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pod_terminals_pod_id_idx` ON `pod_terminals` (`pod_id`);--> statement-breakpoint
CREATE TABLE `pods` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`cwd` text NOT NULL,
	`shell` text,
	`env` text,
	`status` text DEFAULT 'stopped' NOT NULL,
	`target_id` text,
	`environment_id` text,
	`runtime` text,
	`container_id` text,
	`resolved_ports` text,
	`detected_ports` text,
	`container_lifecycle` text DEFAULT 'inherit' NOT NULL,
	`slice_branch` text,
	`git_context` text,
	`active_view_id` text,
	`orca_project_ref` text,
	`is_template` integer DEFAULT false NOT NULL,
	`template_description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pods_workspace_id_idx` ON `pods` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `pods_status_idx` ON `pods` (`status`);--> statement-breakpoint
CREATE INDEX `pods_is_template_idx` ON `pods` (`is_template`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`node_run_id` text,
	`type` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_run_id`) REFERENCES `node_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_events_run_id_idx` ON `run_events` (`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `run_events_run_node_type_idx` ON `run_events` (`workflow_run_id`,`node_run_id`,`type`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 9876 NOT NULL,
	`auth_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_views` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `view_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`scope_id` text,
	`view_type` text DEFAULT 'tabs' NOT NULL,
	`config` text,
	`item_defaults` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`name` text NOT NULL,
	`view_type` text DEFAULT 'tabs' NOT NULL,
	`config` text,
	`item_settings` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `views_pod_id_idx` ON `views` (`pod_id`);--> statement-breakpoint
CREATE TABLE `workflow_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_version_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`source_handle` text,
	`label` text,
	FOREIGN KEY (`workflow_version_id`) REFERENCES `workflow_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_node_id`) REFERENCES `workflow_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_node_id`) REFERENCES `workflow_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_edges_source_target_handle_unique` ON `workflow_edges` (`source_node_id`,`target_node_id`,`source_handle`);--> statement-breakpoint
CREATE INDEX `workflow_edges_version_id_idx` ON `workflow_edges` (`workflow_version_id`);--> statement-breakpoint
CREATE INDEX `workflow_edges_source_node_idx` ON `workflow_edges` (`source_node_id`);--> statement-breakpoint
CREATE INDEX `workflow_edges_target_node_idx` ON `workflow_edges` (`target_node_id`);--> statement-breakpoint
CREATE TABLE `workflow_node_ports` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_node_id` text NOT NULL,
	`node_type_port_id` text NOT NULL,
	`slug` text NOT NULL,
	`direction` text NOT NULL,
	`data_type` text NOT NULL,
	`is_array` integer DEFAULT false NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`value_source` text,
	`static_value` text,
	`variable_name` text,
	`expression` text,
	`on_unresolved` text DEFAULT 'fail' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_node_id`) REFERENCES `workflow_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_type_port_id`) REFERENCES `node_type_ports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_node_ports_node_slug_unique` ON `workflow_node_ports` (`workflow_node_id`,`slug`);--> statement-breakpoint
CREATE INDEX `workflow_node_ports_node_id_idx` ON `workflow_node_ports` (`workflow_node_id`);--> statement-breakpoint
CREATE TABLE `workflow_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_version_id` text NOT NULL,
	`node_type_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`parent_node_id` text,
	`config` text,
	`set_variables` text,
	`position_x` real DEFAULT 0 NOT NULL,
	`position_y` real DEFAULT 0 NOT NULL,
	`content_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_version_id`) REFERENCES `workflow_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_type_id`) REFERENCES `node_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_node_id`) REFERENCES `workflow_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_nodes_version_slug_unique` ON `workflow_nodes` (`workflow_version_id`,`slug`);--> statement-breakpoint
CREATE INDEX `workflow_nodes_version_id_idx` ON `workflow_nodes` (`workflow_version_id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_version_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`trigger_data` text,
	`variables` text,
	`error` text,
	`pod_id` text,
	`parent_run_id` text,
	`parent_node_run_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_version_id`) REFERENCES `workflow_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workflow_runs_version_id_idx` ON `workflow_runs` (`workflow_version_id`);--> statement-breakpoint
CREATE INDEX `workflow_runs_pod_id_idx` ON `workflow_runs` (`pod_id`);--> statement-breakpoint
CREATE TABLE `workflow_trigger_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_version_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`data_type` text NOT NULL,
	`is_array` integer DEFAULT false NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`default_value` text,
	`description` text,
	`order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workflow_version_id`) REFERENCES `workflow_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_trigger_inputs_version_slug_unique` ON `workflow_trigger_inputs` (`workflow_version_id`,`slug`);--> statement-breakpoint
CREATE TABLE `workflow_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_version_id` text NOT NULL,
	`name` text NOT NULL,
	`data_type` text NOT NULL,
	`is_array` integer DEFAULT false NOT NULL,
	`default_value` text,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_version_id`) REFERENCES `workflow_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_variables_version_name_unique` ON `workflow_variables` (`workflow_version_id`,`name`);--> statement-breakpoint
CREATE TABLE `workflow_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`trigger_config` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_versions_workflow_id_version_unique` ON `workflow_versions` (`workflow_id`,`version`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflows_slug_unique` ON `workflows` (`slug`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`default_template_pod_id` text,
	`auto_generate_pod_name` integer DEFAULT false NOT NULL,
	`default_runtime` text,
	`git_worktree_enabled` integer DEFAULT false NOT NULL,
	`git_worktree_copy_hidden_files` integer DEFAULT false NOT NULL,
	`worktree_location_mode` text,
	`worktree_base_dir` text,
	`branch_from` text,
	`remote_origin` text,
	`script_setup` text,
	`script_run` text,
	`script_archive` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_template_pod_id`) REFERENCES `pods`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_settings_workspace_id_unique` ON `workspace_settings` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_views` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`view_type` text DEFAULT 'columns' NOT NULL,
	`config` text DEFAULT '{"type":"columns","rows":[{"items":[]}]}' NOT NULL,
	`item_settings` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_views_workspace_id_idx` ON `workspace_views` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cwd` text DEFAULT '' NOT NULL,
	`repo_path` text,
	`orca_ref` text,
	`target_id` text,
	`environment_id` text,
	`active_workspace_view_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
