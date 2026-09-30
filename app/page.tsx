import { redirect } from "next/navigation";
import { GlitterPosApp } from "@/components/templates/glitter-pos-app";
import { PowerSyncProvider } from "@/components/providers/powersync-provider";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { getTenantMembersForTenant } from "@/lib/auth/tenant-members";
import { getInventoryMovementsForTenant } from "@/lib/inventory/repository";
import { getActiveInvitationForTenant } from "@/lib/invitations/repository";
import { getProductsForTenant } from "@/lib/products/repository";
import { getSalesForTenant } from "@/lib/sales/repository";
import { getRequestOrigin } from "@/lib/request-origin";
import { getCategoriesForTenant } from "@/lib/categories/repository";

export default async function Home() {
  const context = await ensureUserTenantContext();

  if (!context) {
    redirect("/login");
  }

  const inviteOrigin = await getRequestOrigin();

  const [
    initialCategories,
    initialProducts,
    initialSales,
    initialTenantMembers,
    initialInventoryMovements,
    activeInvitation,
  ] = context.tenant
    ? await Promise.all([
        getCategoriesForTenant(context.tenant.id),
        getProductsForTenant(context.tenant.id),
        getSalesForTenant(context.tenant.id),
        getTenantMembersForTenant(context.tenant.id),
        getInventoryMovementsForTenant(context.tenant.id),
        getActiveInvitationForTenant(context.tenant.id),
      ])
    : [[], [], [], [], [], null];

  return (
    <PowerSyncProvider
      identity={{
        userId: context.user.id,
        tenantId: context.tenant?.id ?? null,
      }}
    >
      <GlitterPosApp
        tenantContext={context}
        initialCategories={initialCategories}
        initialProducts={initialProducts}
        initialSales={initialSales}
        initialTenantMembers={initialTenantMembers}
        initialInventoryMovements={initialInventoryMovements}
        activeInvitation={activeInvitation}
        inviteOrigin={inviteOrigin ?? ""}
      />
    </PowerSyncProvider>
  );
}
