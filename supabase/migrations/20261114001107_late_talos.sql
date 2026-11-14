CREATE TABLE "deleted_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"auth_deleted_at" timestamp with time zone
);
