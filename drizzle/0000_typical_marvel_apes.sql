CREATE TABLE `event_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`active_question` integer DEFAULT 0 NOT NULL,
	`reveal_answers` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reactions` (
	`response_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`response_id`, `participant_id`),
	FOREIGN KEY (`response_id`) REFERENCES `responses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `responses` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`data` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`highlighted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_responses_question_participant` ON `responses` (`question_id`,`participant_id`);