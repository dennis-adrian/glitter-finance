import { GlitterPosApp } from "@/components/templates/glitter-pos-app";
import { redirect } from "next/navigation";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { getProductsForTenant } from "@/lib/products/repository";
import { getSalesForTenant } from "@/lib/sales/repository";

export default async function Home() {
  const context = await ensureUserTenantContext();

  if (!context) {
    redirect("/login");
  }

  const [initialProducts, initialSales] = context.tenant
    ? await Promise.all([
        getProductsForTenant(context.tenant.id),
        getSalesForTenant(context.tenant.id),
      ])
    : [[], []];

  return (
    <GlitterPosApp
      tenantContext={context}
      initialProducts={initialProducts}
      initialSales={initialSales}
    />
  );
}
