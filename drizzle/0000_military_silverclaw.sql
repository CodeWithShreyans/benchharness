CREATE TABLE `benchmark_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`suite_id` text NOT NULL,
	`suite_name` text NOT NULL,
	`task_id` text NOT NULL,
	`task_title` text NOT NULL,
	`harness_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_name` text NOT NULL,
	`model_provider` text,
	`model_config` text NOT NULL,
	`status` text NOT NULL,
	`sandbox_id` text,
	`command_id` text,
	`score` real,
	`passed` integer,
	`duration_ms` integer,
	`token_usage` text,
	`cost_estimate` real,
	`logs` text,
	`artifacts` text NOT NULL,
	`raw_harness_result` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `benchmark_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `benchmark_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`cell_id` text,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `benchmark_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cell_id`) REFERENCES `benchmark_cells`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `benchmark_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`suite_ids` text NOT NULL,
	`harnesses` text NOT NULL,
	`task_limit` integer NOT NULL,
	`max_concurrency` integer NOT NULL,
	`cell_count` integer NOT NULL,
	`completed_cell_count` integer DEFAULT 0 NOT NULL,
	`failed_cell_count` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `leaderboard_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`suite_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
