INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;
--> statement-breakpoint

CREATE POLICY IF NOT EXISTS "product images are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');
