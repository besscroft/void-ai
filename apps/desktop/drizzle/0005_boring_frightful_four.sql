CREATE TABLE `agent_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`detail_json` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_run_steps_run` ON `agent_run_steps` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_run_steps_agent` ON `agent_run_steps` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_run_steps_started` ON `agent_run_steps` (`started_at`);--> statement-breakpoint
CREATE TABLE `conversation_agent_state` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`active_agent_id` text,
	`current_run_id` text,
	`current_step_id` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`summary` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`current_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`current_step_id`) REFERENCES `agent_run_steps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_agent_state_agent` ON `conversation_agent_state` (`active_agent_id`);--> statement-breakpoint
CREATE INDEX `idx_conversation_agent_state_run` ON `conversation_agent_state` (`current_run_id`);--> statement-breakpoint
CREATE TABLE `sandbox_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`url` text,
	`size_bytes` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sandbox_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sandbox_artifacts_session` ON `sandbox_artifacts` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_sandbox_artifacts_created` ON `sandbox_artifacts` (`created_at`);--> statement-breakpoint
CREATE TABLE `sandbox_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`run_id` text,
	`agent_id` text,
	`root_path` text NOT NULL,
	`isolation_mode` text NOT NULL,
	`status` text NOT NULL,
	`docker_available` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sandbox_sessions_conversation` ON `sandbox_sessions` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_sandbox_sessions_run` ON `sandbox_sessions` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_sandbox_sessions_updated` ON `sandbox_sessions` (`updated_at`);--> statement-breakpoint
CREATE TABLE `sandbox_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`label` text NOT NULL,
	`manifest_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sandbox_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sandbox_snapshots_session` ON `sandbox_snapshots` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_sandbox_snapshots_created` ON `sandbox_snapshots` (`created_at`);--> statement-breakpoint
ALTER TABLE `agents` ADD `enabled` integer DEFAULT 1 NOT NULL;