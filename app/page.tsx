import { redirect } from "next/navigation";
import { GlitterPosApp } from "@/components/templates/glitter-pos-app";
import { PowerSyncProvider } from "@/components/providers/powersync-provider";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { getTenantMembersForTenant } from "@/lib/auth/tenant-members";
import { getInventorySnapshotForTenant } from "@/lib/inventory/repository";
import { getActiveInvitationForTenant } from "@/lib/invitations/repository";
import { getProductsForTenant } from "@/lib/products/repository";
import { getSalesForTenant } from "@/lib/sales/repository";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * How many days of stock movements '/' sends as rows; the stock from before
 * them arrives summed per product (getInventorySnapshotForTenant). Far longer
 * than the void window, so stock counts a sale that can still be voided from
 * its row.
 */
const RECENT_HISTORY_DAYS = 35;

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadTenantData(tenantId: string) {
  const recentHistoryStart = new Date(
    Date.now() - RECENT_HISTORY_DAYS * DAY_MS
  );
  const members = getTenantMembersForTenant(tenantId);

  const [products, sales, tenantMembers, inventory, activeInvitation] =
    await Promise.all([
      getProductsForTenant(tenantId),
      getSalesForTenant(tenantId, { members }),
      members,
      getInventorySnapshotForTenant(tenantId, recentHistoryStart),
      getActiveInvitationForTenant(tenantId),
    ]);

  return { products, sales, tenantMembers, inventory, activeInvitation };
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
        inventory: null,
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
        initialInventory={data.inventory}
        activeInvitation={data.activeInvitation}
        inviteOrigin={inviteOrigin ?? ""}
      />
    </PowerSyncProvider>
  );
}
