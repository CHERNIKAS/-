CREATE TYPE "public"."expense_kind" AS ENUM('expense', 'income');--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "kind" "expense_kind" DEFAULT 'expense' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "income_source" varchar(32);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "refunded_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "expenses_kind_idx" ON "expenses" USING btree ("ledger_id","kind","spent_at");