CREATE TABLE `access_events` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`user_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `access_event_date_idx` ON `access_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`student_id` text NOT NULL,
	`assessed_at` text NOT NULL,
	`weight_kg` real NOT NULL,
	`height_cm` real NOT NULL,
	`body_fat_pct` real,
	`waist_cm` real,
	`chest_cm` real,
	`hip_cm` real,
	`notes` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assessment_measurements_valid" CHECK("assessments"."weight_kg">0 and "assessments"."height_cm">0)
);
--> statement-breakpoint
CREATE INDEX `assessments_student_idx` ON `assessments` (`student_id`,`assessed_at`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_object_key_unique` ON `assets` (`object_key`);--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`check_in` text NOT NULL,
	`check_out` text,
	`created_by` text NOT NULL,
	`override_reason` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_open_attendance` ON `attendance` (`student_id`) WHERE "attendance"."check_out" is null;--> statement-breakpoint
CREATE INDEX `attendance_date_idx` ON `attendance` (`check_in`);--> statement-breakpoint
CREATE INDEX `attendance_student_idx` ON `attendance` (`student_id`,`check_in`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_date_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_unique` ON `bookings` (`class_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `bookings_class_idx` ON `bookings` (`class_id`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`modality` text NOT NULL,
	`instructor_id` text,
	`starts_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`capacity` integer NOT NULL,
	`location` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	FOREIGN KEY (`instructor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "class_capacity_valid" CHECK("classes"."capacity">0)
);
--> statement-breakpoint
CREATE INDEX `classes_start_idx` ON `classes` (`starts_at`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`muscle_group` text NOT NULL,
	`equipment` text,
	`instructions` text,
	`video_url` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`paid_at` text,
	CONSTRAINT "expense_amount_valid" CHECK("expenses"."amount_cents">0),
	CONSTRAINT "expense_status_valid" CHECK("expenses"."status" in ('open','paid','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `expenses_status_due_idx` ON `expenses` (`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`student_id` text NOT NULL,
	`membership_id` text,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`payment_method` text,
	`paid_at` text,
	`cancel_reason` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_amount_valid" CHECK("invoices"."amount_cents">=0),
	CONSTRAINT "invoice_status_valid" CHECK("invoices"."status" in ('open','paid','refunded','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `invoice_student_idx` ON `invoices` (`student_id`);--> statement-breakpoint
CREATE INDEX `invoice_status_due_idx` ON `invoices` (`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`source` text,
	`interest` text,
	`notes` text,
	`status` text DEFAULT 'new' NOT NULL,
	`student_id` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`login_key` text NOT NULL,
	`ip_key` text NOT NULL,
	`created_at` text NOT NULL,
	`success` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_window_idx` ON `login_attempts` (`login_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_ip_window_idx` ON `login_attempts` (`ip_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `membership_events` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`user_id` text NOT NULL,
	`event` text NOT NULL,
	`reason` text,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `membership_events_idx` ON `membership_events` (`membership_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`student_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`contracted_price_cents` integer NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`duration_months` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`reason` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "membership_price_valid" CHECK("memberships"."contracted_price_cents">=0 and "memberships"."discount_cents">=0 and "memberships"."discount_cents"<="memberships"."contracted_price_cents"),
	CONSTRAINT "membership_status_valid" CHECK("memberships"."status" in ('active','suspended','cancelled','expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_membership_per_student` ON `memberships` (`student_id`) WHERE "memberships"."status" in ('active','suspended');--> statement-breakpoint
CREATE INDEX `membership_student_idx` ON `memberships` (`student_id`);--> statement-breakpoint
CREATE TABLE `notification_reads` (
	`notification_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` text NOT NULL,
	PRIMARY KEY(`notification_id`, `user_id`),
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`recipient_id` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notification_recipient_idx` ON `notifications` (`recipient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `operation_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`entity_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_amount_valid" CHECK("payments"."amount_cents">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency_key_unique` ON `payments` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_completed_payment` ON `payments` (`invoice_id`) WHERE "payments"."status"='completed';--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_cents` integer NOT NULL,
	`duration_months` integer NOT NULL,
	`modalities` text,
	`access_start` text,
	`access_end` text,
	`status` text DEFAULT 'active' NOT NULL,
	CONSTRAINT "plan_price_nonnegative" CHECK("plans"."price_cents" >= 0),
	CONSTRAINT "plan_duration_positive" CHECK("plans"."duration_months" between 1 and 36)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`category` text,
	`price_cents` integer NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	CONSTRAINT "product_stock_nonnegative" CHECK("products"."stock">=0),
	CONSTRAINT "product_prices_nonnegative" CHECK("products"."price_cents">=0 and "products"."cost_cents">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_sku_unique` ON `products` (`sku`) WHERE "products"."sku" is not null and "products"."sku" != '';--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_item_valid" CHECK("purchase_items"."quantity">0 and "purchase_items"."unit_cost_cents">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_product_unique` ON `purchase_items` (`purchase_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`supplier_id` text NOT NULL,
	`total_cents` integer NOT NULL,
	`notes` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`received_at` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_amount_valid" CHECK("purchases"."total_cents">=0)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_payment_id_unique` ON `refunds` (`payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_idempotency_key_unique` ON `refunds` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_item_valid" CHECK("sale_items"."quantity">0 and "sale_items"."unit_price_cents">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_product_unique` ON `sale_items` (`sale_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`student_id` text,
	`method` text NOT NULL,
	`total_cents` integer NOT NULL,
	`notes` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`refund_reason` text,
	`refunded_at` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_amount_valid" CHECK("sales"."total_cents">=0)
);
--> statement-breakpoint
CREATE TABLE `seed_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'gym' NOT NULL,
	`value` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`position` text NOT NULL,
	`specialty` text,
	`user_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `staff_name_idx` ON `staff` (`name`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`reference_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movement_product_idx` ON `stock_movements` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`cpf` text,
	`birth_date` text,
	`address` text,
	`emergency_name` text,
	`emergency_phone` text,
	`notes` text,
	`trainer_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`trainer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "student_status_valid" CHECK("students"."status" in ('active','inactive'))
);
--> statement-breakpoint
CREATE INDEX `students_name_idx` ON `students` (`name`);--> statement-breakpoint
CREATE INDEX `students_trainer_idx` ON `students` (`trainer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `students_cpf_unique` ON `students` (`cpf`) WHERE "students"."cpf" is not null and "students"."cpf" != '';--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`contact_name` text,
	`email` text,
	`phone` text,
	`document` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`ok` integer NOT NULL,
	CONSTRAINT "transaction_guard" CHECK("transaction_guards"."ok"=1)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`login` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`must_change_password` integer DEFAULT 0 NOT NULL,
	`totp_secret` text,
	`totp_enabled` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "users_active_bool" CHECK("users"."active" in (0,1)),
	CONSTRAINT "users_role_valid" CHECK("users"."role" in ('super_admin','admin','manager','reception','finance','trainer','personal'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_login_unique` ON `users` (lower("login"));--> statement-breakpoint
CREATE TABLE `workout_history` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workout_history_parent_idx` ON `workout_history` (`workout_id`);--> statement-breakpoint
CREATE TABLE `workout_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`day` text NOT NULL,
	`sets` integer NOT NULL,
	`reps` text NOT NULL,
	`load` text,
	`rest_seconds` integer NOT NULL,
	`notes` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workout_items_parent_idx` ON `workout_items` (`workout_id`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`student_id` text NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`student_id` text NOT NULL,
	`trainer_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text,
	`notes` text,
	`valid_until` text,
	`status` text DEFAULT 'draft' NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trainer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workout_student_idx` ON `workouts` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_workout` ON `workouts` (`student_id`) WHERE "workouts"."status"='active';--> statement-breakpoint
CREATE TRIGGER booking_capacity_guard BEFORE INSERT ON bookings BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM classes WHERE id=NEW.class_id AND status='scheduled' AND julianday(starts_at)>julianday('now')) THEN RAISE(ABORT,'class_unavailable') END;
 SELECT CASE WHEN (SELECT count(*) FROM bookings WHERE class_id=NEW.class_id)>=(SELECT capacity FROM classes WHERE id=NEW.class_id) THEN RAISE(ABORT,'capacity_exceeded') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM students WHERE id=NEW.student_id AND status='active') THEN RAISE(ABORT,'student_inactive') END;
END;
--> statement-breakpoint
CREATE TRIGGER class_capacity_update_guard BEFORE UPDATE OF capacity ON classes BEGIN
 SELECT CASE WHEN NEW.capacity<(SELECT count(*) FROM bookings WHERE class_id=NEW.id) THEN RAISE(ABORT,'capacity_exceeded') END;
END;
--> statement-breakpoint
CREATE TRIGGER payment_state_guard BEFORE INSERT ON payments BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM invoices WHERE id=NEW.invoice_id AND status IN ('open','refunded') AND amount_cents=NEW.amount_cents) THEN RAISE(ABORT,'payment_state_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER refund_state_guard BEFORE INSERT ON refunds BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM payments WHERE id=NEW.payment_id AND invoice_id=NEW.invoice_id AND status='completed' AND amount_cents=NEW.amount_cents) THEN RAISE(ABORT,'refund_state_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'audit_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'audit_immutable'); END;
