CREATE TABLE `agent_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_path` text NOT NULL,
	`parent_instance_id` text,
	`parent_agent_path` text,
	`status` text NOT NULL,
	`task_name` text NOT NULL,
	`task_summary` text NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`last_message` text,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_instances_run` ON `agent_instances` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_instances_path` ON `agent_instances` (`run_id`,`agent_path`);--> statement-breakpoint
CREATE INDEX `idx_agent_instances_status` ON `agent_instances` (`status`);--> statement-breakpoint
CREATE TABLE `agent_collaboration_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`author_path` text NOT NULL,
	`recipient_path` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`delivered_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_messages_run` ON `agent_collaboration_messages` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_messages_recipient` ON `agent_collaboration_messages` (`run_id`,`recipient_path`);--> statement-breakpoint
CREATE TABLE `agent_context_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`conversation_id` text,
	`agent_instance_id` text,
	`agent_path` text NOT NULL,
	`version` integer NOT NULL,
	`reason` text NOT NULL,
	`summary` text NOT NULL,
	`source_message_count` integer NOT NULL,
	`retained_message_count` integer NOT NULL,
	`estimated_tokens_before` integer NOT NULL,
	`estimated_tokens_after` integer NOT NULL,
	`model_ref` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_instance_id`) REFERENCES `agent_instances`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_context_checkpoints_conversation` ON `agent_context_checkpoints` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_context_checkpoints_instance` ON `agent_context_checkpoints` (`agent_instance_id`);--> statement-breakpoint
ALTER TABLE `runtime_events` ADD `event_type` text;--> statement-breakpoint
ALTER TABLE `runtime_events` ADD `agent_path` text;--> statement-breakpoint
ALTER TABLE `runtime_events` ADD `parent_agent_path` text;--> statement-breakpoint
ALTER TABLE `runtime_events` ADD `sequence` integer;
