CREATE TABLE "dns_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"host" text NOT NULL,
	"record_type" text NOT NULL,
	"target" text NOT NULL,
	"ttl" integer DEFAULT 3600 NOT NULL,
	"source" text NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dns_records_domain_id_host_record_type_uniq" UNIQUE("domain_id","host","record_type")
);
--> statement-breakpoint
CREATE TABLE "subdomain_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"repo_url" text,
	"repo_summary" jsonb,
	"proposal" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subdomain_plans_domain_id_uniq" UNIQUE("domain_id")
);
--> statement-breakpoint
ALTER TABLE "dns_records" ADD CONSTRAINT "dns_records_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subdomain_plans" ADD CONSTRAINT "subdomain_plans_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dns_records_domain_id_idx" ON "dns_records" USING btree ("domain_id");