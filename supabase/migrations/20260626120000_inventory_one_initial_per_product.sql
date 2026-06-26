-- At most one initial-stock movement per product within a tenant.

CREATE UNIQUE INDEX "inventory_movements_one_initial_per_product_idx"
ON "inventory_movements" ("tenant_id", "product_id")
WHERE "reason" = 'initial';
