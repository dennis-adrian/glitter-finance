-- Apply after `pnpm db:push` and after
-- 20260610012304_product_image_upload_policy_membership.sql, in the Supabase
-- SQL editor. Every statement is idempotent, so the file can be re-run.
--
-- Product images are uploaded with the signed-in user's session: straight from
-- the browser in PowerSync mode (lib/powersync/write-products.ts) and from the
-- uploadProductImage server action otherwise. The app checks size and type
-- before uploading, but a client can skip that, so Storage enforces the rules:
--
-- 1. The product-images bucket accepts JPEG and PNG up to 5 MiB. Hosted
--    projects only get these limits from this file: supabase/config.toml sets
--    them for the local stack alone, and `supabase seed buckets --linked`
--    would also upload the local seed images, so do not use it.
-- 2. A user can upload only to <tenant_id>/products/<product_id>/<uuid>.<jpg|png>
--    in a tenant they belong to (tenant_users membership). This replaces the
--    policy from 20260610012304, which checked the tenant folder only.
-- 3. A user can delete product images in the folder of a tenant they belong
--    to. The app deletes an image whose product write failed and the image
--    that a newer upload replaced. Members can already point any product of
--    the tenant at another image, so this grants no new power over the tenant.
--
-- Rules mirrored in TypeScript (keep them in step):
--   5 MiB, image/jpeg and image/png -> lib/product-image-config.ts
--                                      (and supabase/config.toml)
--   object path shape               -> buildProductImageObjectPath and
--                                      isProductImageObjectPath in
--                                      lib/product-image-config.ts

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The tenant that owns a product image object, or NULL when the name is not a
-- product image path (seed images, anything else in the bucket). Returning
-- NULL instead of casting blindly keeps the policies from raising 22P02 on
-- other names; current_user_has_tenant(NULL) is false.
CREATE OR REPLACE FUNCTION public.product_image_tenant_id(object_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN object_name ~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '/products/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(jpg|png)$'
    )
    THEN split_part(object_name, '/', 1)::uuid
  END;
$$;

DROP POLICY IF EXISTS "tenant members can upload product images" ON storage.objects;

CREATE POLICY "tenant members can upload product images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND public.current_user_has_tenant(public.product_image_tenant_id(name))
);

DROP POLICY IF EXISTS "tenant members can delete product images" ON storage.objects;

CREATE POLICY "tenant members can delete product images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND public.current_user_has_tenant(public.product_image_tenant_id(name))
);

-- The policies run as the signed-in user. anon has no Storage write policy.
REVOKE ALL ON FUNCTION public.product_image_tenant_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_image_tenant_id(text) TO authenticated;
