ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "operation_logs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD COLUMN "sv_trid" text;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;