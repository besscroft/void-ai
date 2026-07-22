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
CREATE TABLE `agent_run_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`message_json` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`consumed_at` integer,
	`discarded_reason` text,
	FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_run_inputs_run_status_sequence` ON `agent_run_inputs` (`run_id`,`status`,`sequence`);--> statement-breakpoint
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
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'New conversation' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`message_revision` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	`purge_after_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_deleted_at` ON `conversations` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_purge_after_at` ON `conversations` (`purge_after_at`);--> statement-breakpoint
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
	`confidence` integer DEFAULT 70 NOT NULL,
	`origin` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`supersedes_id` text,
	`mem0_id` text,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`strength` integer DEFAULT 70 NOT NULL,
	`last_reinforced_at` integer,
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
CREATE INDEX `idx_memories_status` ON `memories` (`status`);--> statement-breakpoint
CREATE INDEX `idx_memories_origin` ON `memories` (`origin`);--> statement-breakpoint
CREATE INDEX `idx_memories_last_used` ON `memories` (`last_used_at`);--> statement-breakpoint
CREATE INDEX `idx_memories_expires` ON `memories` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_memories_mem0` ON `memories` (`mem0_id`);--> statement-breakpoint
CREATE INDEX `idx_memories_sync_status` ON `memories` (`sync_status`);--> statement-breakpoint
CREATE TABLE `memory_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text,
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
);
--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_status_scheduled` ON `memory_jobs` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_kind` ON `memory_jobs` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_idempotency` ON `memory_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_conversation` ON `memory_jobs` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_agent` ON `memory_jobs` (`agent_id`);--> statement-breakpoint
CREATE TABLE `memory_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`kind` text NOT NULL,
	`source_conversation_id` text,
	`source_run_id` text,
	`source_agent_id` text,
	`confidence` integer DEFAULT 50 NOT NULL,
	`evidence_count` integer DEFAULT 1 NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`promoted_memory_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_run_id`) REFERENCES `runtime_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promoted_memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memory_observations_dedupe` ON `memory_observations` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_memory_observations_status_expires` ON `memory_observations` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_observations_conversation` ON `memory_observations` (`source_conversation_id`);--> statement-breakpoint
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
	`event_type` text,
	`agent_path` text,
	`parent_agent_path` text,
	`sequence` integer,
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
	`origin` text DEFAULT 'chat' NOT NULL,
	`finish_reason` text,
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
	`timeout_seconds` integer DEFAULT 60 NOT NULL,
	`last_error` text,
	`last_connected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`purge_after_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_tool_servers_kind` ON `tool_servers` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_tool_servers_enabled` ON `tool_servers` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_tool_servers_status` ON `tool_servers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tool_servers_deleted_at` ON `tool_servers` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_tool_servers_purge_after_at` ON `tool_servers` (`purge_after_at`);--> statement-breakpoint
CREATE TABLE `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`name` text NOT NULL,
	`title` text,
	`description` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`reference` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`auto_use` integer DEFAULT 0 NOT NULL,
	`requires_approval` integer DEFAULT 1 NOT NULL,
	`input_schema_json` text DEFAULT '{}' NOT NULL,
	`output_schema_json` text DEFAULT '{}' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`trigger_keywords_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`discovered_at` integer NOT NULL,
	`last_run_at` integer,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`purge_after_at` integer,
	FOREIGN KEY (`server_id`) REFERENCES `tool_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tools_server` ON `tools` (`server_id`);--> statement-breakpoint
CREATE INDEX `idx_tools_kind` ON `tools` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_tools_reference` ON `tools` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_tools_enabled` ON `tools` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_tools_deleted_at` ON `tools` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_tools_purge_after_at` ON `tools` (`purge_after_at`);