ALTER TABLE `workflows` ADD `nodes_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflows` ADD `entry_node_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflows` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `error` text;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `context_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `triggered_by` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `triggered_by_agent_id` text REFERENCES agents(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `conversation_id` text REFERENCES conversations(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_started` ON `workflow_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_status` ON `workflow_runs` (`status`);--> statement-breakpoint
CREATE TABLE `workflow_step_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `workflow_run_id` text NOT NULL REFERENCES workflow_runs(id) ON UPDATE no action ON DELETE cascade,
  `node_id` text NOT NULL,
  `status` text NOT NULL,
  `attempt` integer DEFAULT 1 NOT NULL,
  `input_json` text,
  `output_json` text,
  `error` text,
  `started_at` integer,
  `finished_at` integer,
  `duration_ms` integer,
  `assigned_agent_id` text REFERENCES agents(id) ON UPDATE no action ON DELETE set null,
  `metadata_json` text DEFAULT '{}' NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_workflow_step_runs_run` ON `workflow_step_runs` (`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_step_runs_started` ON `workflow_step_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `workflow_transitions` (
  `id` text PRIMARY KEY NOT NULL,
  `workflow_run_id` text NOT NULL REFERENCES workflow_runs(id) ON UPDATE no action ON DELETE cascade,
  `from_node_id` text,
  `to_node_id` text NOT NULL,
  `reason` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_workflow_transitions_run` ON `workflow_transitions` (`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_transitions_created` ON `workflow_transitions` (`created_at`);
