CREATE TABLE "oauth_clients" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(128),
	"redirect_uris" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_requests" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text,
	"code_challenge" varchar(128) NOT NULL,
	"scope" varchar(64) DEFAULT 'read' NOT NULL,
	"user_id" integer,
	"approved_at" timestamp with time zone,
	"denied_at" timestamp with time zone,
	"code_hash" varchar(64),
	"code_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"scope" varchar(64) NOT NULL,
	"access_hash" varchar(64) NOT NULL,
	"refresh_hash" varchar(64) NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_access_key" ON "oauth_tokens" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_refresh_key" ON "oauth_tokens" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "oauth_tokens_user_idx" ON "oauth_tokens" USING btree ("user_id");