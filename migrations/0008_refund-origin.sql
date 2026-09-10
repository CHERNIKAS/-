ALTER TABLE "expenses" ADD COLUMN "refund_import_id" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "refund_fingerprint" varchar(64);