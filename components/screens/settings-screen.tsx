import { Box, CreditCard, ReceiptText, RotateCcw } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { SettingsItem } from "@/components/molecules/settings-item";

type SettingsScreenProps = {
  productCount: number;
  saleCount: number;
  pendingCount: number;
  resetDemo: () => void;
};

export function SettingsScreen({ productCount, saleCount, pendingCount, resetDemo }: SettingsScreenProps) {
  return (
    <section className="screen settings-screen">
      <Header title="Ajustes" left={<BrandMark />} />
      <section className="panel account-panel">
        <div className="avatar large">AG</div>
        <div>
          <h2>Cuenta Glitter Demo</h2>
          <p>Modo local-first. Las ventas se guardan en este dispositivo.</p>
        </div>
      </section>
      <section className="settings-list">
        <SettingsItem icon={<Box size={21} />} label="Productos activos" value={String(productCount)} />
        <SettingsItem icon={<ReceiptText size={21} />} label="Ventas registradas" value={String(saleCount)} />
        <SettingsItem icon={<RotateCcw size={21} />} label="Pendientes de sincronizar" value={String(pendingCount)} />
        <SettingsItem icon={<CreditCard size={21} />} label="Métodos de pago" value="Efectivo · QR" />
      </section>
      <button className="secondary-action reset-button" onClick={resetDemo}>
        Restaurar datos demo
      </button>
    </section>
  );
}
