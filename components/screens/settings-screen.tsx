"use client";

import { useState } from "react";
import {
  Box,
  CreditCard,
  ReceiptText,
  RotateCcw,
  Stethoscope,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { SettingsItem } from "@/components/molecules/settings-item";
import { Button } from "@/components/ui/button";
import { usePowerSyncControls } from "@/components/providers/powersync-provider";
import type { UserTenantContext } from "@/lib/auth/user-context";
import type { TenantMember } from "@/lib/types";

type SettingsScreenProps = {
  tenantContext: UserTenantContext;
  tenantMembers: TenantMember[];
  teamSyncPending?: boolean;
  productCount: number;
  saleCount: number;
  pendingCount: number;
  openDiagnostics: () => void;
};

export function SettingsScreen({
  tenantContext,
  tenantMembers,
  teamSyncPending = false,
  productCount,
  saleCount,
  pendingCount,
  openDiagnostics,
}: SettingsScreenProps) {
  const identity =
    tenantContext.user.displayName ||
    tenantContext.user.email ||
    "Glitter Finance";
  const initials = identity.slice(0, 2).toUpperCase();
  const powerSyncControls = usePowerSyncControls();
  const [signingOut, setSigningOut] = useState(false);

  // Wipe the per-device PowerSync store before the Supabase session is
  // dropped so the next user on this device starts with an empty local DB.
  // `disconnectAndClear` needs a live PowerSync connection, so it must run
  // before the auth cookies go away.
  async function handleSignOut(_formData: FormData) {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await powerSyncControls?.clearLocal();
    } catch (error) {
      console.error("[signOut] clearLocal failed", error);
    }
    try {
      await signOut();
    } catch (error) {
      console.error("[signOut] signOut failed", error);
      setSigningOut(false);
    }
  }

  return (
    <section className="screen">
      <Header title="Ajustes" left={<BrandMark />} />

      <section className="flex items-center gap-3.5 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="grid size-14 shrink-0 place-items-center rounded-full bg-primary/10 text-base font-bold text-primary">
          {initials}
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {tenantContext.tenant?.name ?? "Cuenta Glitter"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tenantContext.user.email ?? "Usuario autenticado"} · Catálogo
            sincronizado con Supabase.
          </p>
        </div>
      </section>

      <section className="my-4 grid gap-2.5">
        <SettingsItem
          icon={<Box size={21} />}
          label="Productos activos"
          value={String(productCount)}
        />
        <SettingsItem
          icon={<ReceiptText size={21} />}
          label="Ventas registradas"
          value={String(saleCount)}
        />
        <SettingsItem
          icon={<RotateCcw size={21} />}
          label="Ventas cargadas"
          value={String(pendingCount)}
        />
        <SettingsItem
          icon={<CreditCard size={21} />}
          label="Métodos de pago"
          value="Efectivo · QR"
        />
        <button
          type="button"
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-2xl"
          onClick={openDiagnostics}
        >
          <SettingsItem
            icon={<Stethoscope size={21} />}
            label="Diagnósticos"
            value="Estado de sincronización y dispositivo"
          />
        </button>
      </section>

      <section className="mt-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-3 text-lg font-semibold">Equipo</h2>
        {teamSyncPending ? (
          <p className="mb-3 text-sm leading-snug text-muted-foreground">
            Sincronizando el equipo… Si esto persiste, revisa la conexión en
            Diagnósticos.
          </p>
        ) : null}
        <div className="grid">
          {tenantMembers.map((member) => {
            const isCurrentUser = member.userId === tenantContext.user.id;
            const memberInitials = member.displayName.slice(0, 2).toUpperCase();
            return (
              <div
                className="flex items-center gap-2.5 border-b border-border py-2 last:border-b-0"
                key={member.id}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {memberInitials}
                </span>
                <span>
                  <strong className="block text-sm">
                    {member.displayName}
                  </strong>
                  <small className="block text-xs text-muted-foreground">
                    {isCurrentUser
                      ? `Tú${tenantContext.user.email ? ` · ${tenantContext.user.email}` : ""}`
                      : "Vendedor en esta cuenta"}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Varios vendedores pueden registrar ventas en la misma cuenta desde sus
          propios teléfonos. Los nuevos miembros se agregan por invitación
          manual durante las pruebas cerradas.
        </p>
      </section>

      <form action={handleSignOut} className="mt-5">
        <Button
          variant="outline"
          size="lg"
          type="submit"
          disabled={signingOut}
          className="w-full rounded-2xl"
        >
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </Button>
      </form>
    </section>
  );
}
