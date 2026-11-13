CREATE TABLE "former_tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "former_tenant_members_tenant_id_user_id_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "former_tenant_members" ADD CONSTRAINT "former_tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;