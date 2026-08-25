CREATE TABLE "operation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text,
	"registry" text NOT NULL,
	"command" text NOT NULL,
	"domain_name" text,
	"status" text NOT NULL,
	"error_code" text,
	"registry_code" text,
	"request" jsonb,
	"response" jsonb,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain_name" text NOT NULL,
	"registry" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_logs_user_id_created_at_idx" ON "operation_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transfers_user_id_idx" ON "transfers" USING btree ("user_id");