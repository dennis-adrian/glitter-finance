import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GlitterPosApp } from "@/components/templates/glitter-pos-app";
import { PowerSyncProvider } from "@/components/providers/powersync-provider";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { getTenantMembersForTenant } from "@/lib/auth/tenant-members";
import { getInventoryMovementsForTenant } from "@/lib/inventory/repository";
import { getActiveInvitationForTenant } from "@/lib/invitations/repository";
import { getProductsForTenant } from "@/lib/products/repository";
import { getSalesForTenant } from "@/lib/sales/repository";

export default async function Home() {
  const context = await ensureUserTenantContext();

  if (!context) {
    redirect("/login");
  }

  const headerStore = await headers();
  const inviteOrigin =
    headerStore.get("origin") ??
    `https://${headerStore.get("x-forwarded-host") ?? headerStore.get("host")}`;

  const [initialProducts, initialSales, initialTenantMembers, initialInventoryMovements, activeInvitation] =
    context.tenant
      ? await Promise.all([
          getProductsForTenant(context.tenant.id),
          getSalesForTenant(context.tenant.id),
          getTenantMembersForTenant(context.tenant.id),
          getInventoryMovementsForTenant(context.tenant.id),
          getActiveInvitationForTenant(context.tenant.id),
        ])
      : [[], [], [], [], null];

  return (
    <PowerSyncProvider>
      <GlitterPosApp
        tenantContext={context}
        initialProducts={initialProducts}
        initialSales={initialSales}
        initialTenantMembers={initialTenantMembers}
        initialInventoryMovements={initialInventoryMovements}
        activeInvitation={activeInvitation}
        inviteOrigin={inviteOrigin}
      />
    </PowerSyncProvider>
  );
}
