ALTER TYPE "public"."expense_kind" ADD VALUE 'transfer';--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "counterparty" varchar(128);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paired_with_id" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "needs_kind_review" boolean DEFAULT false NOT NULL;