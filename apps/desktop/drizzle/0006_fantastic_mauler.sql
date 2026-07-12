CREATE TABLE `artifact_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`source_id` text,
	`artifact_type` text NOT NULL,
	`name` text NOT NULL,
	`version` text,
	`content_hash` text,
	`install_path` text,
	`status` text DEFAULT 'disabled' NOT NULL,
	`safety_json` text DEFAULT '{}' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`tool_server_id` text,
	`skill_id` text,
	`last_error` text,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `catalog_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_id`) REFERENCES `catalog_sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tool_server_id`) REFERENCES `tool_servers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`skill_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_installations_item` ON `artifact_installations` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_installations_type` ON `artifact_installations` (`artifact_type`,`status`);--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`version` text,
	`install_url` text,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`content_hash` text,
	`cached_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `catalog_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_items_source` ON `catalog_items` (`source_id`,`artifact_type`);--> statement-breakpoint
CREATE INDEX `idx_catalog_items_name` ON `catalog_items` (`name`);--> statement-breakpoint
CREATE TABLE `catalog_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`builtin` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_sources_kind` ON `catalog_sources` (`kind`,`enabled`);--> statement-breakpoint
CREATE TABLE `cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`schedule_json` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`conversation_id` text NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`claimed_at` integer,
	`claim_token` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cron_jobs_due` ON `cron_jobs` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `idx_cron_jobs_conversation` ON `cron_jobs` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `cron_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`scheduled_for` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`attempt` integer DEFAULT 1 NOT NULL,
	`output` text,
	`error` text,
	`runtime_run_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `cron_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cron_runs_job` ON `cron_runs` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cron_runs_status` ON `cron_runs` (`status`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `message_revision` integer DEFAULT 0 NOT NULL;