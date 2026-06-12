-- Storage INSERT policy for product images. Lets authenticated users
-- upload to the `product-images` bucket from the browser using their own
-- Supabase JWT, replacing the previous flow that ran uploads server-side
-- with the admin client (admin uploads bypass RLS).
--
-- Path convention: <tenant_id>/products/<product_id>/<uuid>.<ext>
-- The policy reads tenant_id from the JWT's `app_metadata.tenant_id`
-- claim (set by lib/auth/user-context.ts on bootstrap, and by the QA
-- seed) and only allows the upload when the path's first folder matches.
--
-- DELETE and UPDATE are intentionally not granted: image replacement
-- writes to a fresh uuid path, and we never delete images in this MVP.
-- SELECT stays public per the bucket setup migration.

CREATE POLICY "tenant members can upload product images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (
    auth.jwt() -> 'app_metadata' ->> 'tenant_id'
  )
);
