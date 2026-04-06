CREATE TABLE `cycle_log` (
	`id` text PRIMARY KEY NOT NULL,
	`triggered_by` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `cycle_log_started_at_idx` ON `cycle_log` (`started_at`);--> statement-breakpoint
ALTER TABLE `scan_log` ADD `cycle_id` text REFERENCES cycle_log(id);--> statement-breakpoint
CREATE INDEX `scan_log_cycle_idx` ON `scan_log` (`cycle_id`);