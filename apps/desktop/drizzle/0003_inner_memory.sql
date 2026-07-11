ALTER TABLE `memories` ADD `confidence` integer DEFAULT 70 NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `origin` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `evidence_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `last_used_at` integer;--> statement-breakpoint
ALTER TABLE `memories` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `memories` ADD `supersedes_id` text;--> statement-breakpoint
CREATE INDEX `idx_memories_status` ON `memories` (`status`);--> statement-breakpoint
CREATE INDEX `idx_memories_origin` ON `memories` (`origin`);--> statement-breakpoint
CREATE INDEX `idx_memories_last_used` ON `memories` (`last_used_at`);--> statement-breakpoint
CREATE INDEX `idx_memories_expires` ON `memories` (`expires_at`);--> statement-breakpoint
CREATE TABLE `memory_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`conversation_id` text,
	`agent_id` text,
	`run_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`scheduled_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_status_scheduled` ON `memory_jobs` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_kind` ON `memory_jobs` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_conversation` ON `memory_jobs` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_agent` ON `memory_jobs` (`agent_id`);
