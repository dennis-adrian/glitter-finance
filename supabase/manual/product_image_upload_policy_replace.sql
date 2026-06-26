-- Idempotent storage INSERT policy refresh for environments that already ran
-- 20260610012303_product_image_upload_policy.sql before the policy was
-- recreated. Run in the Supabase SQL editor when uploads fail with a
-- duplicate-policy error.

DROP POLICY IF EXISTS "tenant members can upload product images" ON storage.objects;

CREATE POLICY "tenant members can upload product images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (
    auth.jwt() -> 'app_metadata' ->> 'tenant_id'
  )
);
