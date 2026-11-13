CREATE TABLE "tenant_storage_cleanups" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
