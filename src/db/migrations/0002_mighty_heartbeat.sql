CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`job_id` text NOT NULL,
	`purpose` text NOT NULL,
	`triggered_by` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_workspace_started_idx` ON `job_runs` (`workspace_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `job_runs_job_started_idx` ON `job_runs` (`job_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `job_runs_status_idx` ON `job_runs` (`status`);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_dispatch_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `events_workspace_occurred_idx` ON `events` (`workspace_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `events_status_occurred_idx` ON `events` (`status`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `events_kind_idx` ON `events` (`kind`);
--> statement-breakpoint
CREATE TABLE `hook_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL REFERENCES `events`(`id`) ON DELETE cascade,
	`workspace_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`hook_key` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`exit_code` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `hook_runs_event_idx` ON `hook_runs` (`event_id`);
--> statement-breakpoint
CREATE INDEX `hook_runs_workspace_started_idx` ON `hook_runs` (`workspace_id`,`started_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `hook_runs_event_hook_attempt_unique` ON `hook_runs` (`event_id`,`hook_key`,`attempt`);
