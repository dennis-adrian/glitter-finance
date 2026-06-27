ALTER TABLE "tenant_users" DROP CONSTRAINT "tenant_users_tenant_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "tenant_users_tenant_id_idx" ON "tenant_users" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_user_id_unique" UNIQUE("tenant_id","user_id");