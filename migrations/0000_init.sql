CREATE TYPE "public"."bot_message_kind" AS ENUM('card', 'panel', 'summary');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USD', 'EUR', 'UAH', 'TRY');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."payment" AS ENUM('card', 'cash', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('bot', 'app');--> statement-breakpoint
CREATE TABLE "bot_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bot_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"chat_id" numeric(20, 0) NOT NULL,
	"message_id" integer NOT NULL,
	"kind" "bot_message_kind" NOT NULL,
	"expense_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleaned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ledger_id" integer NOT NULL,
	"slug" varchar(32) NOT NULL,
	"title" varchar(64) NOT NULL,
	"emoji" varchar(8) DEFAULT '📦' NOT NULL,
	"hint" text,
	"sort" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expenses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ledger_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"category_id" integer,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"rate_to_usd" numeric(18, 8) NOT NULL,
	"spent_at" date NOT NULL,
	"merchant" varchar(128),
	"note" text,
	"source" "source" NOT NULL,
	"payment" "payment" DEFAULT 'card' NOT NULL,
	"confidence" numeric(3, 2),
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_members" (
	"ledger_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_members_ledger_id_user_id_pk" PRIMARY KEY("ledger_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ledgers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledgers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(128) NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"owner_id" integer NOT NULL,
	"invite_token" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rates" (
	"day" date NOT NULL,
	"currency" "currency" NOT NULL,
	"to_usd" numeric(18, 8) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rates_day_currency_pk" PRIMARY KEY("day","currency")
);
--> statement-breakpoint
CREATE TABLE "raw_inputs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "raw_inputs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"chat_id" numeric(20, 0) NOT NULL,
	"tg_message_id" integer NOT NULL,
	"text" text NOT NULL,
	"parsed_json" text,
	"deleted_from_chat" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"pattern" varchar(128) NOT NULL,
	"category_id" integer NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tg_id" numeric(20, 0) NOT NULL,
	"username" varchar(64),
	"first_name" varchar(128),
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Istanbul' NOT NULL,
	"reminder_enabled" boolean DEFAULT true NOT NULL,
	"reminder_hour" smallint DEFAULT 21 NOT NULL,
	"monthly_digest" boolean DEFAULT false NOT NULL,
	"daily_cleanup" boolean DEFAULT false NOT NULL,
	"partner_notifications" boolean DEFAULT true NOT NULL,
	"monthly_budget" numeric(14, 2),
	"default_payment" "payment" DEFAULT 'card' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_messages" ADD CONSTRAINT "bot_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD CONSTRAINT "bot_messages_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_members" ADD CONSTRAINT "ledger_members_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_members" ADD CONSTRAINT "ledger_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ledgers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_inputs" ADD CONSTRAINT "raw_inputs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_messages_chat_message_key" ON "bot_messages" USING btree ("chat_id","message_id");--> statement-breakpoint
CREATE INDEX "bot_messages_cleanup_idx" ON "bot_messages" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_ledger_slug_key" ON "categories" USING btree ("ledger_id","slug");--> statement-breakpoint
CREATE INDEX "expenses_ledger_spent_at_idx" ON "expenses" USING btree ("ledger_id","spent_at");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expenses_needs_review_idx" ON "expenses" USING btree ("needs_review");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_inputs_chat_message_key" ON "raw_inputs" USING btree ("chat_id","tg_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_user_pattern_key" ON "rules" USING btree ("user_id","pattern");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tg_id_key" ON "users" USING btree ("tg_id");