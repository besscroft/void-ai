CREATE TABLE `extension_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_extension_secrets_owner` ON `extension_secrets` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_extension_secrets_key` ON `extension_secrets` (`key`);--> statement-breakpoint
CREATE TABLE `extension_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`auto_use` integer DEFAULT 0 NOT NULL,
	`requires_approval` integer DEFAULT 1 NOT NULL,
	`trigger_keywords_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`config_schema_json` text DEFAULT '{}' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`workflow_id` text,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_extension_skills_enabled` ON `extension_skills` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_extension_skills_category` ON `extension_skills` (`category`);--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`transport` text NOT NULL,
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
CREATE INDEX `idx_mcp_servers_enabled` ON `mcp_servers` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_mcp_servers_status` ON `mcp_servers` (`status`);--> statement-breakpoint
CREATE TABLE `mcp_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`title` text,
	`description` text NOT NULL,
	`input_schema_json` text DEFAULT '{}' NOT NULL,
	`output_schema_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`auto_use` integer DEFAULT 0 NOT NULL,
	`requires_approval` integer DEFAULT 1 NOT NULL,
	`discovered_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mcp_tools_server` ON `mcp_tools` (`server_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_tools_enabled` ON `mcp_tools` (`enabled`);