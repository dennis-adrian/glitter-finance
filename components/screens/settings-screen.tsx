import { Box, CreditCard, ReceiptText, RotateCcw } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { SettingsItem } from "@/components/molecules/settings-item";
import type { UserTenantContext } from "@/lib/auth/user-context";

type SettingsScreenProps = {
  tenantContext: UserTenantContext;
  productCount: number;
  saleCount: number;
  pendingCount: number;
  resetDemo: () => void;
};

export function SettingsScreen({
  tenantContext,
  productCount,
  saleCount,
  pendingCount,
  resetDemo,
}: SettingsScreenProps) {
  const identity =
    tenantContext.user.displayName ||
    tenantContext.user.email ||
    "Glitter Finance";
  const initials = identity.slice(0, 2).toUpperCase();

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
      </section>
      <button className="secondary-action reset-button" onClick={resetDemo}>
        Restaurar datos demo
      </button>
      <form action={signOut}>
        <button className="secondary-action reset-button" type="submit">
          Cerrar sesión
        </button>
      </form>
    </section>
  );
}
