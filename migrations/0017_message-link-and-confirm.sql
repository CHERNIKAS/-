ALTER TABLE "expenses" ADD COLUMN "raw_input_id" integer;--> statement-breakpoint
ALTER TABLE "oauth_requests" ADD COLUMN "confirm_code" varchar(8);--> statement-breakpoint
ALTER TABLE "oauth_requests" ADD COLUMN "confirm_attempts" smallint DEFAULT 0 NOT NULL;