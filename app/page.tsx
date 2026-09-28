import { redirect } from "next/navigation";
import { GlitterPosApp } from "@/components/templates/glitter-pos-app";
import { PowerSyncProvider } from "@/components/providers/powersync-provider";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { getTenantMembersForTenant } from "@/lib/auth/tenant-members";
import { isPowerSyncConfigured } from "@/lib/env";
import { getInventorySnapshotForTenant } from "@/lib/inventory/repository";
import { getActiveInvitationForTenant } from "@/lib/invitations/repository";
import { getProductsForTenant } from "@/lib/products/repository";
import { getSalesForTenant } from "@/lib/sales/repository";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * How much history '/' sends as rows: enough for every preset range of Sales
 * and Reports ("Esta semana", "Este mes"), and far longer than the void
 * window, so stock counts a sale that can still be voided from its row. The
 * stock from before it arrives summed per product
 * (getInventorySnapshotForTenant).
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
      // With PowerSync the device's local store holds the whole history once
      // its first sync completes; these rows only paint the screens until
      // then, so recent sales are enough. Without it these sales are the
      // whole history the screens have, so custom ranges need all of them.
      getSalesForTenant(tenantId, {
        since: isPowerSyncConfigured() ? recentHistoryStart : undefined,
        members,
      }),
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
