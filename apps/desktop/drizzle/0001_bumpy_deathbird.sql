ALTER TABLE `tool_servers` ADD `timeout_seconds` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `tool_servers` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `tool_servers` ADD `purge_after_at` integer;--> statement-breakpoint
CREATE INDEX `idx_tool_servers_deleted_at` ON `tool_servers` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_tool_servers_purge_after_at` ON `tool_servers` (`purge_after_at`);--> statement-breakpoint
ALTER TABLE `tools` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `tools` ADD `purge_after_at` integer;--> statement-breakpoint
CREATE INDEX `idx_tools_deleted_at` ON `tools` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_tools_purge_after_at` ON `tools` (`purge_after_at`);