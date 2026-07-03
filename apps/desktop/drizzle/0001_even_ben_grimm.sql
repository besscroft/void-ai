CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`description` text NOT NULL,
	`personality` text NOT NULL,
	`soul_prompt` text NOT NULL,
	`avatar` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`model_ref` text,
	`voice` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE TABLE `harness_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_harness_events_created` ON `harness_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `interaction_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`config_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`agent_id` text,
	`conversation_id` text,
	`salience` integer DEFAULT 50 NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memories_agent` ON `memories` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_memories_conversation` ON `memories` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_memories_salience` ON `memories` (`salience`);--> statement-breakpoint
CREATE TABLE `server_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`capabilities_json` text NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_server_nodes_kind` ON `server_nodes` (`kind`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`endpoint` text,
	`device_id` text NOT NULL,
	`encryption_enabled` integer DEFAULT 1 NOT NULL,
	`conflict_strategy` text NOT NULL,
	`status` text NOT NULL,
	`last_synced_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text,
	`output_json` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_workflow` ON `workflow_runs` (`workflow_id`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`steps_json` text NOT NULL,
	`trigger` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workflows_status` ON `workflows` (`status`);