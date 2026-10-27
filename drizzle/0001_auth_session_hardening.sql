ALTER TABLE `sessions` ADD `last_seen_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_last_counter` integer DEFAULT -1 NOT NULL;
--> statement-breakpoint
-- Existing sessions retain their original activity age; migration does not extend access.
UPDATE `sessions` SET `last_seen_at`=`created_at` WHERE `last_seen_at`='';
