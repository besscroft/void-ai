ALTER TABLE `conversations` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `purge_after_at` integer;--> statement-breakpoint
CREATE INDEX `idx_conversations_deleted_at` ON `conversations` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_purge_after_at` ON `conversations` (`purge_after_at`);