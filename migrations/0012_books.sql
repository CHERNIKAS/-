CREATE TYPE "public"."ledger_kind" AS ENUM('personal', 'shared', 'business');--> statement-breakpoint
ALTER TABLE "ledgers" ADD COLUMN "kind" "ledger_kind" DEFAULT 'personal' NOT NULL;