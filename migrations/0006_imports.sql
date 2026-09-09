CREATE TYPE "public"."import_status" AS ENUM('preview', 'applied', 'cancelled');--> statement-breakpoint
CREATE TABLE "imports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "imports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"ledger_id" integer NOT NULL,
	"filename" varchar(255) NOT NULL,
	"status" "import_status" DEFAULT 'preview' NOT NULL,
	"payload" text,
	"mapping" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_fingerprint_idx" ON "expenses" USING btree ("ledger_id","fingerprint");