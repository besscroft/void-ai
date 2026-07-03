CREATE TABLE `model_api_keys` (
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`provider_id`, `model_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_model_api_keys_provider` ON `model_api_keys` (`provider_id`);
