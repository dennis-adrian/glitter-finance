-- Development seed data loaded by `supabase db reset`.
-- Demo login:
--   email: demo@glitter-pos.local
--   password: glitter-demo

BEGIN;

DELETE FROM "public"."refunds"
WHERE "tenant_id" = '70000000-0000-4000-8000-000000000001'
  OR "user_id" = '60000000-0000-4000-8000-000000000001';

DELETE FROM "public"."sale_lines"
WHERE "tenant_id" = '70000000-0000-4000-8000-000000000001';

DELETE FROM "public"."sales"
WHERE "tenant_id" = '70000000-0000-4000-8000-000000000001'
  OR "user_id" = '60000000-0000-4000-8000-000000000001';

DELETE FROM "public"."products"
WHERE "tenant_id" = '70000000-0000-4000-8000-000000000001';

DELETE FROM "public"."tenant_users"
WHERE "tenant_id" = '70000000-0000-4000-8000-000000000001'
  OR "user_id" = '60000000-0000-4000-8000-000000000001';

DELETE FROM "public"."tenants"
WHERE "id" = '70000000-0000-4000-8000-000000000001';

DELETE FROM "auth"."identities"
WHERE "user_id" = '60000000-0000-4000-8000-000000000001';

DELETE FROM "auth"."users"
WHERE "id" = '60000000-0000-4000-8000-000000000001';

INSERT INTO "auth"."users" (
  "instance_id",
  "id",
  "aud",
  "role",
  "email",
  "encrypted_password",
  "email_confirmed_at",
  "last_sign_in_at",
  "raw_app_meta_data",
  "raw_user_meta_data",
  "created_at",
  "updated_at",
  "confirmation_token",
  "email_change",
  "email_change_token_new",
  "recovery_token"
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '60000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'demo@glitter-pos.local',
  crypt('glitter-demo', gen_salt('bf')),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"display_name": "Demo Vendedora"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

INSERT INTO "auth"."identities" (
  "id",
  "provider_id",
  "user_id",
  "identity_data",
  "provider",
  "last_sign_in_at",
  "created_at",
  "updated_at"
)
VALUES (
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '{"sub": "60000000-0000-4000-8000-000000000001", "email": "demo@glitter-pos.local", "email_verified": true, "phone_verified": false}'::jsonb,
  'email',
  now(),
  now(),
  now()
);

INSERT INTO "public"."tenants" (
  "id",
  "name",
  "created_at",
  "updated_at"
)
VALUES (
  '70000000-0000-4000-8000-000000000001',
  'Cuenta demo',
  now(),
  now()
);

INSERT INTO "public"."tenant_users" (
  "tenant_id",
  "user_id",
  "display_name",
  "created_at"
)
VALUES (
  '70000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'Demo Vendedora',
  now()
);

INSERT INTO "public"."products" (
  "id",
  "tenant_id",
  "name",
  "price_cents",
  "cost_cents",
  "category",
  "image_path",
  "archived_at",
  "created_at",
  "updated_at"
)
VALUES
  (
    '80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'Lámina ilustrada',
    4000,
    1500,
    'Láminas',
    'seed/print-seed.jpg',
    null,
    now() - interval '18 days',
    now() - interval '18 days'
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    'Pegatina de mascota',
    1500,
    350,
    'Pegatinas',
    'placeholder:coral',
    null,
    now() - interval '18 days',
    now() - interval '18 days'
  ),
  (
    '80000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000001',
    'Llavero de personaje',
    2500,
    900,
    'Accesorios',
    'placeholder:linen',
    null,
    now() - interval '17 days',
    now() - interval '17 days'
  ),
  (
    '80000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000001',
    'Pin decorativo',
    1200,
    null,
    'Pines',
    'seed/pin-seed.jpg',
    null,
    now() - interval '16 days',
    now() - interval '16 days'
  ),
  (
    '80000000-0000-4000-8000-000000000005',
    '70000000-0000-4000-8000-000000000001',
    'Bolsa de feria',
    12000,
    5200,
    'Accesorios',
    'seed/totebag-seed.jpg',
    null,
    now() - interval '15 days',
    now() - interval '15 days'
  ),
  (
    '80000000-0000-4000-8000-000000000006',
    '70000000-0000-4000-8000-000000000001',
    'Hoja de pegatinas holográficas',
    3500,
    1250,
    'Pegatinas',
    'placeholder:aurora',
    null,
    now() - interval '14 days',
    now() - interval '14 days'
  ),
  (
    '80000000-0000-4000-8000-000000000007',
    '70000000-0000-4000-8000-000000000001',
    'Paquete de láminas mini',
    7500,
    3000,
    'Láminas',
    'placeholder:linen',
    null,
    now() - interval '13 days',
    now() - interval '13 days'
  ),
  (
    '80000000-0000-4000-8000-000000000008',
    '70000000-0000-4000-8000-000000000001',
    'Dije de la temporada pasada',
    2200,
    800,
    'Accesorios',
    'placeholder:coral',
    now() - interval '2 days',
    now() - interval '30 days',
    now() - interval '2 days'
  );

INSERT INTO "public"."sales" (
  "id",
  "tenant_id",
  "user_id",
  "payment_method",
  "sale_discount_cents",
  "sale_discount_reason",
  "voided_at",
  "voided_by_user_id",
  "created_at",
  "client_created_at"
)
VALUES
  (
    '90000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'cash',
    500,
    'Combo festival',
    null,
    null,
    now() - interval '35 minutes',
    now() - interval '35 minutes'
  ),
  (
    '90000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'qr_transfer',
    0,
    null,
    null,
    null,
    now() - interval '2 hours',
    now() - interval '2 hours'
  ),
  (
    '90000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'qr_transfer',
    1000,
    'Amiga emprendedora',
    null,
    null,
    now() - interval '1 day',
    now() - interval '1 day'
  ),
  (
    '90000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'cash',
    0,
    null,
    null,
    null,
    now() - interval '8 days',
    now() - interval '8 days'
  ),
  (
    '90000000-0000-4000-8000-000000000005',
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'cash',
    0,
    null,
    now() - interval '4 minutes',
    '60000000-0000-4000-8000-000000000001',
    now() - interval '6 minutes',
    now() - interval '6 minutes'
  ),
  (
    '90000000-0000-4000-8000-000000000006',
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'qr_transfer',
    0,
    null,
    null,
    null,
    now() - interval '3 days',
    now() - interval '3 days'
  );

INSERT INTO "public"."sale_lines" (
  "id",
  "sale_id",
  "tenant_id",
  "product_id",
  "product_name",
  "category",
  "quantity",
  "unit_price_cents",
  "unit_cost_cents",
  "line_discount_cents",
  "line_discount_reason",
  "line_total_cents",
  "created_at"
)
VALUES
  (
    '91000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
    'Pegatina de mascota',
    'Pegatinas',
    2,
    1500,
    350,
    300,
    'Promoción 2x',
    2700,
    now() - interval '35 minutes'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    'Lámina ilustrada',
    'Láminas',
    1,
    4000,
    1500,
    0,
    null,
    4000,
    now() - interval '35 minutes'
  ),
  (
    '91000000-0000-4000-8000-000000000003',
    '90000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000005',
    'Bolsa de feria',
    'Accesorios',
    1,
    12000,
    5200,
    0,
    null,
    12000,
    now() - interval '2 hours'
  ),
  (
    '91000000-0000-4000-8000-000000000004',
    '90000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000004',
    'Pin decorativo',
    'Pines',
    3,
    1200,
    null,
    0,
    null,
    3600,
    now() - interval '2 hours'
  ),
  (
    '91000000-0000-4000-8000-000000000005',
    '90000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000003',
    'Llavero de personaje',
    'Accesorios',
    2,
    2500,
    900,
    0,
    null,
    5000,
    now() - interval '1 day'
  ),
  (
    '91000000-0000-4000-8000-000000000006',
    '90000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000006',
    'Hoja de pegatinas holográficas',
    'Pegatinas',
    1,
    3500,
    1250,
    0,
    null,
    3500,
    now() - interval '1 day'
  ),
  (
    '91000000-0000-4000-8000-000000000007',
    '90000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000007',
    'Paquete de láminas mini',
    'Láminas',
    1,
    7500,
    3000,
    0,
    null,
    7500,
    now() - interval '8 days'
  ),
  (
    '91000000-0000-4000-8000-000000000008',
    '90000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000004',
    'Pin decorativo',
    'Pines',
    4,
    1200,
    null,
    800,
    'Liquidación',
    4000,
    now() - interval '8 days'
  ),
  (
    '91000000-0000-4000-8000-000000000009',
    '90000000-0000-4000-8000-000000000005',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
    'Pegatina de mascota',
    'Pegatinas',
    1,
    1500,
    350,
    0,
    null,
    1500,
    now() - interval '6 minutes'
  ),
  (
    '91000000-0000-4000-8000-000000000010',
    '90000000-0000-4000-8000-000000000006',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    'Lámina ilustrada',
    'Láminas',
    2,
    4000,
    1500,
    500,
    'Marco con lámina',
    7500,
    now() - interval '3 days'
  ),
  (
    '91000000-0000-4000-8000-000000000011',
    '90000000-0000-4000-8000-000000000006',
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000003',
    'Llavero de personaje',
    'Accesorios',
    1,
    2500,
    900,
    0,
    null,
    2500,
    now() - interval '3 days'
  );

INSERT INTO "public"."refunds" (
  "id",
  "tenant_id",
  "original_sale_id",
  "user_id",
  "reason",
  "created_at",
  "client_created_at"
)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000006',
  '60000000-0000-4000-8000-000000000001',
  'Cambio de diseño',
  now() - interval '2 days',
  now() - interval '2 days'
);

COMMIT;
