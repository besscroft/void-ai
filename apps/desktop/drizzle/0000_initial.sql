CREATE TABLE `agent_policies` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`tool_policy_json` text DEFAULT '{}' NOT NULL,
	`review_policy_json` text DEFAULT '{}' NOT NULL,
	`sandbox_policy_json` text DEFAULT '{}' NOT NULL,
	`routing_policy_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_policies_updated` ON `agent_policies` (`updated_at`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`instructions` text NOT NULL,
	`persona` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar` text DEFAULT 'VA' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`kind` text DEFAULT 'child' NOT NULL,
	`parent_agent_id` text,
	`locked` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`model_ref` text,
	`voice` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agents_kind` ON `agents` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_agents_parent` ON `agents` (`parent_agent_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'New conversation' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`purge_after_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_deleted_at` ON `conversations` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_purge_after_at` ON `conversations` (`purge_after_at`);--> statement-breakpoint
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
	`source_run_id` text,
	`salience` integer DEFAULT 50 NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memories_agent` ON `memories` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_memories_conversation` ON `memories` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_memories_source_run` ON `memories` (`source_run_id`);--> statement-breakpoint
CREATE INDEX `idx_memories_salience` ON `memories` (`salience`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content_json` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `model_api_keys` (
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`provider_id`, `model_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_model_api_keys_provider` ON `model_api_keys` (`provider_id`);--> statement-breakpoint
CREATE TABLE `model_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`source` text DEFAULT 'custom' NOT NULL,
	`base_url` text,
	`help_url` text DEFAULT '' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`step_id` text,
	`conversation_id` text,
	`agent_id` text,
	`tool_id` text,
	`owner_type` text,
	`owner_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`step_id`) REFERENCES `runtime_steps`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_runtime_events_run` ON `runtime_events` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_events_step` ON `runtime_events` (`step_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_events_conversation` ON `runtime_events` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_events_agent` ON `runtime_events` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_events_tool` ON `runtime_events` (`tool_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_events_owner` ON `runtime_events` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_events_created` ON `runtime_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_runtime_events_kind` ON `runtime_events` (`kind`);--> statement-breakpoint
CREATE TABLE `runtime_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`root_agent_id` text,
	`final_agent_id` text,
	`workflow_id` text,
	`status` text NOT NULL,
	`model_ref` text,
	`trace_id` text,
	`input_summary` text,
	`output_summary` text,
	`error` text,
	`usage_json` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`root_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`final_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_runtime_runs_conversation` ON `runtime_runs` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_runs_root_agent` ON `runtime_runs` (`root_agent_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_runs_started` ON `runtime_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_runtime_runs_status` ON `runtime_runs` (`status`);--> statement-breakpoint
CREATE TABLE `runtime_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text,
	`tool_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_runtime_steps_run` ON `runtime_steps` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_steps_agent` ON `runtime_steps` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_steps_kind` ON `runtime_steps` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_runtime_steps_started` ON `runtime_steps` (`started_at`);--> statement-breakpoint
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
	FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE set null,
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
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_profiles` (
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
CREATE TABLE `tool_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tool_secrets_owner` ON `tool_secrets` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_tool_secrets_key` ON `tool_secrets` (`key`);--> statement-breakpoint
CREATE TABLE `tool_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'mcp' NOT NULL,
	`transport` text DEFAULT 'stdio' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`auto_use` integer DEFAULT 0 NOT NULL,
	`requires_approval` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`command` text,
	`args_json` text DEFAULT '[]' NOT NULL,
	`url` text,
	`headers_json` text DEFAULT '{}' NOT NULL,
	`env_json` text DEFAULT '{}' NOT NULL,
	`cwd` text,
	`last_error` text,
	`last_connected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tool_servers_kind` ON `tool_servers` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_tool_servers_enabled` ON `tool_servers` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_tool_servers_status` ON `tool_servers` (`status`);--> statement-breakpoint
CREATE TABLE `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`name` text NOT NULL,
	`title` text,
	`description` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`reference` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`auto_use` integer DEFAULT 0 NOT NULL,
	`requires_approval` integer DEFAULT 1 NOT NULL,
	`input_schema_json` text DEFAULT '{}' NOT NULL,
	`output_schema_json` text DEFAULT '{}' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`workflow_id` text,
	`trigger_keywords_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`discovered_at` integer NOT NULL,
	`last_run_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `tool_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tools_server` ON `tools` (`server_id`);--> statement-breakpoint
CREATE INDEX `idx_tools_kind` ON `tools` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_tools_reference` ON `tools` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_tools_enabled` ON `tools` (`enabled`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`runtime_run_id` text,
	`status` text NOT NULL,
	`input_json` text,
	`output_json` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runtime_run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_workflow` ON `workflow_runs` (`workflow_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_runtime` ON `workflow_runs` (`runtime_run_id`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workflows_status` ON `workflows` (`status`);