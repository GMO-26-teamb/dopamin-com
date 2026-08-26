CREATE TABLE "mock_registry_state" (
	"registry" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
