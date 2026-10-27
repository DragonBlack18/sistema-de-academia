CREATE INDEX `login_attempts_retention_idx` ON `login_attempts` (`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_activity_idx` ON `sessions` (`last_seen_at`);