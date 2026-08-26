ALTER TABLE "transfers" ADD COLUMN "domain_id" uuid;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "registry_status" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "counterpart_registrar_id" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "registry_message_id" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "act_by_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_registry_message_id_uniq" UNIQUE("registry","registry_message_id");