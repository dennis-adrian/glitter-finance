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
    <section className="screen settings-screen">
      <Header title="Ajustes" left={<BrandMark />} />
      <section className="panel account-panel">
        <div className="avatar large">{initials}</div>
        <div>
          <h2>{tenantContext.tenant?.name ?? "Cuenta Glitter"}</h2>
          <p>
            {tenantContext.user.email ?? "Usuario autenticado"} · Catálogo
            sincronizado con Supabase.
          </p>
        </div>
      </section>
      <section className="settings-list">
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
          className="settings-link-button"
          onClick={openDiagnostics}
        >
          <SettingsItem
            icon={<Stethoscope size={21} />}
            label="Diagnósticos"
            value="Estado de sincronización y dispositivo"
          />
        </button>
      </section>
      <section className="panel">
        <h2>Equipo</h2>
        {teamSyncPending ? (
          <p className="settings-team-sync-warning">
            Sincronizando el equipo… Si esto persiste, revisa la conexión en
            Diagnósticos.
          </p>
        ) : null}
        <div className="report-list">
          {tenantMembers.map((member) => {
            const isCurrentUser = member.userId === tenantContext.user.id;
            const memberInitials = member.displayName.slice(0, 2).toUpperCase();
            return (
              <div className="report-list-row" key={member.id}>
                <span className="settings-member-row">
                  <span className="avatar small">{memberInitials}</span>
                  <span>
                    <strong>{member.displayName}</strong>
                    <small>
                      {isCurrentUser
                        ? `Tú${tenantContext.user.email ? ` · ${tenantContext.user.email}` : ""}`
                        : "Vendedor en esta cuenta"}
                    </small>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <p className="settings-team-note">
          Varios vendedores pueden registrar ventas en la misma cuenta desde sus
          propios teléfonos. Los nuevos miembros se agregan por invitación manual
          durante las pruebas cerradas.
        </p>
      </section>
      <form action={handleSignOut}>
        <button
          className="secondary-action reset-button"
          type="submit"
          disabled={signingOut}
        >
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </form>
    </section>
  );
}
