ALTER TABLE "domains" DROP CONSTRAINT "domains_name_unique";--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "ownership" text DEFAULT 'owned' NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "sponsoring_registrar_id" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "transferred_out_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "domains_name_owned_uniq" ON "domains" USING btree ("name") WHERE "domains"."ownership" = 'owned';