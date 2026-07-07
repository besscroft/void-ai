CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`root_agent_id` text NOT NULL,
	`final_agent_id` text,
	`status` text NOT NULL,
	`model_ref` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`trace_id` text,
	`input_summary` text,
	`output_summary` text,
	`error` text,
	`usage_json` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`root_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`final_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_conversation` ON `agent_runs` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_root` ON `agent_runs` (`root_agent_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_started` ON `agent_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `agent_runtime_state` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`current_run_id` text,
	`last_handoff_at` integer,
	`last_tool_at` integer,
	`last_learning_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_status` ON `agent_runtime_state` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_run` ON `agent_runtime_state` (`current_run_id`);--> statement-breakpoint
ALTER TABLE `agents` ADD `kind` text DEFAULT 'child' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `parent_agent_id` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `locked` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `tool_policy_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `handoff_config_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `runtime_config_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_agents_kind` ON `agents` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_agents_parent` ON `agents` (`parent_agent_id`);