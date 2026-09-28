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

async function loadTenantData(tenantId: string) {
  const members = getTenantMembersForTenant(tenantId);

  const [products, sales, tenantMembers, inventoryMovements, activeInvitation] =
    await Promise.all([
      getProductsForTenant(tenantId),
      getSalesForTenant(tenantId, { members }),
      members,
      getInventoryMovementsForTenant(tenantId),
      getActiveInvitationForTenant(tenantId),
    ]);

  return {
    products,
    sales,
    tenantMembers,
    inventoryMovements,
    activeInvitation,
  };
}

export default async function Home() {
  const context = await ensureUserTenantContext();

  if (!context) {
    redirect("/login");
  }

  const inviteOrigin = await getRequestOrigin();

  const data = context.tenant
    ? await loadTenantData(context.tenant.id)
    : {
        products: [],
        sales: [],
        tenantMembers: [],
        inventoryMovements: [],
        activeInvitation: null,
      };

  return (
    <PowerSyncProvider
      identity={{
        userId: context.user.id,
        tenantId: context.tenant?.id ?? null,
        email: context.user.email,
      }}
    >
      <GlitterPosApp
        tenantContext={context}
        initialProducts={data.products}
        initialSales={data.sales}
        initialTenantMembers={data.tenantMembers}
        initialInventoryMovements={data.inventoryMovements}
        activeInvitation={data.activeInvitation}
        inviteOrigin={inviteOrigin ?? ""}
      />
    </PowerSyncProvider>
  );
}
