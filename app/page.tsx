import { GlitterPosApp } from "@/components/templates/glitter-pos-app";
import { PowerSyncProvider } from "@/components/providers/powersync-provider";
import { redirect } from "next/navigation";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { getTenantMembersForTenant } from "@/lib/auth/tenant-members";
import { getProductsForTenant } from "@/lib/products/repository";
import { getSalesForTenant } from "@/lib/sales/repository";

export default async function Home() {
  const context = await ensureUserTenantContext();

  if (!context) {
    redirect("/login");
  }

  const [initialProducts, initialSales, initialTenantMembers] = context.tenant
    ? await Promise.all([
        getProductsForTenant(context.tenant.id),
        getSalesForTenant(context.tenant.id),
        getTenantMembersForTenant(context.tenant.id),
      ])
    : [[], [], []];

  return (
    <PowerSyncProvider>
      <GlitterPosApp
        tenantContext={context}
        initialProducts={initialProducts}
        initialSales={initialSales}
        initialTenantMembers={initialTenantMembers}
      />
    </PowerSyncProvider>
  );
}
