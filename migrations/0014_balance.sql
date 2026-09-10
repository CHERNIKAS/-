CREATE TABLE "balance_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "balance_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ledger_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"place" varchar(64) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"note" varchar(128),
	"happened_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_ledger_idx" ON "balance_entries" USING btree ("ledger_id","place");