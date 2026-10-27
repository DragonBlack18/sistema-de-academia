CREATE TABLE `appearance_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "appearance_presets_kind_valid" CHECK("appearance_presets"."kind" in ('theme','draft')),
	CONSTRAINT "appearance_presets_version_positive" CHECK("appearance_presets"."version" > 0),
	CONSTRAINT "appearance_presets_json_valid" CHECK(json_valid("appearance_presets"."value"))
);
--> statement-breakpoint
CREATE INDEX `appearance_presets_updated_idx` ON `appearance_presets` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `settings_history` (
	`version` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`source` text NOT NULL,
	`restored_from` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_history_version_positive" CHECK("settings_history"."version" > 0),
	CONSTRAINT "settings_history_json_valid" CHECK(json_valid("settings_history"."value")),
	CONSTRAINT "settings_history_source_valid" CHECK("settings_history"."source" in ('initial','update','restore','theme'))
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_preferences_version_positive" CHECK("user_preferences"."version" > 0),
	CONSTRAINT "user_preferences_json_valid" CHECK(json_valid("user_preferences"."value"))
);
