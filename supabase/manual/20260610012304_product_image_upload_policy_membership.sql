-- Run after: 20260610012303_product_image_upload_policy.sql (npm run db:push).
-- Replace JWT app_metadata.tenant_id upload auth with tenant_users membership.
-- Path convention unchanged: <tenant_id>/products/<product_id>/<uuid>.<ext>
-- Idempotent — run after 20260610012303_product_image_upload_policy.sql.

DROP POLICY IF EXISTS "tenant members can upload product images" ON storage.objects;

CREATE POLICY "tenant members can upload product images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND "public"."current_user_has_tenant"(
    (storage.foldername(name))[1]::uuid
  )
);
