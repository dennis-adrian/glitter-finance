"use client";

import { useState } from "react";
import {
  Box,
  Check,
  CloudUpload,
  CreditCard,
  Loader2,
  Plus,
  ReceiptText,
  Stethoscope,
} from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { InviteTeamCard } from "@/components/molecules/invite-team-card";
import { SettingsItem } from "@/components/molecules/settings-item";
import { ThemePicker } from "@/components/molecules/theme-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useTenantSessionActions,
  type TenantSessionCopy,
} from "@/lib/auth/use-tenant-session-actions";
import type { UserTenantContext } from "@/lib/auth/tenant-context";
import { pendingUploadsBlockerMessage } from "@/lib/powersync/local-data-gate";
import type { TenantInvitation, TenantMember } from "@/lib/types";
import { cn } from "@/lib/utils";

const tenantSessionCopy: TenantSessionCopy = {
  switchFailed: "No se pudo cambiar de cuenta.",
  createFailed: "No se pudo crear la cuenta.",
};

type SettingsScreenProps = {
  tenantContext: UserTenantContext;
  tenantMembers: TenantMember[];
  teamSyncPending?: boolean;
  activeInvitation: TenantInvitation | null;
  inviteOrigin: string;
  onInvitationChange?: (invitation: TenantInvitation | null) => void;
  productCount: number;
  saleCount: number;
  openDiagnostics: () => void;
};

export function SettingsScreen({
  tenantContext,
  tenantMembers,
  teamSyncPending = false,
  activeInvitation,
  inviteOrigin,
  onInvitationChange,
  productCount,
  saleCount,
  openDiagnostics,
}: SettingsScreenProps) {
  const identity =
    tenantContext.user.displayName ||
    tenantContext.user.email ||
    "Billetera Ferial";
  const initials = identity.slice(0, 2).toUpperCase();
  const {
    gate,
    switchingTenantId,
    creatingTenant,
    signingOut,
    error: actionError,
    switchTenant,
    createTenant,
    signOut,
  } = useTenantSessionActions({
    activeTenantId: tenantContext.tenant?.id ?? null,
    copy: tenantSessionCopy,
  });
  const canSwitchTenant = gate.canChange;
  const syncFailureCount = gate.failureCount;
  const [showCreatePrompt, setShowCreatePrompt] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const tenantActionError =
    actionError && actionError.action !== "sign-out"
      ? actionError.message
      : null;
  const signOutError =
    actionError?.action === "sign-out" ? actionError.message : null;
  const syncFailureExplanation =
    syncFailureCount === 1
      ? "Hay una operación que no llegó a la nube. Abre Diagnósticos, copia el diagnóstico y resuélvela antes de cerrar sesión."
      : `Hay ${syncFailureCount} operaciones que no llegaron a la nube. Abre Diagnósticos, copia el diagnóstico y resuélvelas antes de cerrar sesión.`;
  const signOutBlockedExplanation =
    gate.blocker === "sync-failures"
      ? syncFailureExplanation
      : gate.blocker === "pending-uploads"
        ? pendingUploadsBlockerMessage(gate.pendingCount, "cerrar sesión")
        : gate.blocker === "not-synced"
          ? "Espera a que termine la sincronización antes de cerrar sesión."
          : null;

  const switchOverlayLabel = creatingTenant
    ? "Creando tu cuenta…"
    : switchingTenantId
      ? "Cambiando de cuenta…"
      : null;

  return (
    <section className="screen">
      {switchOverlayLabel ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-7 animate-spin text-primary" />
            <p className="text-sm font-medium">{switchOverlayLabel}</p>
            <p className="max-w-60 text-center text-xs text-muted-foreground">
              Sincronizando los datos de esta cuenta.
            </p>
          </div>
        </div>
      ) : null}

      <Header title="Ajustes" left={<BrandMark />} />

      <section className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="mb-4 flex items-center gap-3.5">
          <div className="grid size-14 shrink-0 place-items-center rounded-full bg-primary/10 text-base font-bold text-primary">
            {initials}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Tus cuentas</h2>
            <p className="text-sm text-muted-foreground">
              {tenantContext.user.email ?? "Usuario autenticado"}
            </p>
          </div>
        </div>

        {gate.blocker === "sync-failures" ? (
          <p className="mb-3 text-xs leading-relaxed text-destructive">
            La sincronización requiere recuperación. Abre Diagnósticos antes de
            cambiar de cuenta o cerrar sesión.
          </p>
        ) : gate.blocker === "pending-uploads" ? (
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            {pendingUploadsBlockerMessage(
              gate.pendingCount,
              "cambiar de cuenta o cerrar sesión"
            )}
          </p>
        ) : gate.blocker === "not-synced" ? (
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Espera a que termine la sincronización antes de cambiar de cuenta.
          </p>
        ) : null}
        {tenantActionError ? (
          <p className="mb-3 text-sm text-destructive">{tenantActionError}</p>
        ) : null}

        <div className="grid gap-1">
          {tenantContext.tenants.map((tenant) => {
            const isActive = tenant.id === tenantContext.tenant?.id;
            const isSwitching = switchingTenantId === tenant.id;
            return (
              <button
                key={tenant.id}
                type="button"
                disabled={
                  !canSwitchTenant || isActive || Boolean(switchingTenantId)
                }
                onClick={() => void switchTenant(tenant.id)}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted disabled:opacity-50"
                )}
              >
                <span className="font-medium">{tenant.name}</span>
                {isActive ? (
                  <Check className="size-4 shrink-0" />
                ) : isSwitching ? (
                  <span className="text-xs text-muted-foreground">
                    Cambiando…
                  </span>
                ) : null}
              </button>
            );
          })}

          {showCreatePrompt ? (
            <div className="mt-2 grid gap-2 rounded-xl border border-border p-3">
              <Label className="grid gap-1.5 text-sm">
                Nombre de la cuenta
                <Input
                  value={newTenantName}
                  onChange={(event) => setNewTenantName(event.target.value)}
                  placeholder="Ej. Puesto 2"
                  className="h-11 rounded-xl"
                  autoFocus
                />
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => {
                    setShowCreatePrompt(false);
                    setNewTenantName("");
                  }}
                  disabled={creatingTenant}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="rounded-2xl"
                  onClick={() => void createTenant(newTenantName)}
                  disabled={
                    creatingTenant || !newTenantName.trim() || !canSwitchTenant
                  }
                >
                  {creatingTenant ? "Creando…" : "Crear"}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!canSwitchTenant || Boolean(switchingTenantId)}
              onClick={() => setShowCreatePrompt(true)}
              className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-primary hover:bg-muted disabled:opacity-50"
            >
              <Plus className="size-4" />
              <span className="font-medium">Crear nueva cuenta</span>
            </button>
          )}
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
          icon={<CloudUpload size={21} />}
          label="Operaciones sin subir"
          value={String(gate.pendingCount)}
        />
        <SettingsItem
          icon={<CreditCard size={21} />}
          label="Métodos de pago"
          value="Efectivo · QR"
        />
        <button
          type="button"
          className="block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={openDiagnostics}
        >
          <SettingsItem
            icon={<Stethoscope size={21} />}
            label="Diagnósticos"
            value="Estado de sincronización y dispositivo"
            showChevron
          />
        </button>
      </section>

      <section className="mt-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-3 text-lg font-semibold">Apariencia</h2>
        <ThemePicker />
      </section>

      {tenantContext.tenant ? (
        <InviteTeamCard
          tenantId={tenantContext.tenant.id}
          initialInvitation={activeInvitation}
          origin={inviteOrigin}
          onInvitationChange={onInvitationChange}
        />
      ) : null}

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
            const isOwner =
              tenantContext.tenant?.createdByUserId != null &&
              member.userId === tenantContext.tenant.createdByUserId;
            const roleLabel = isOwner
              ? "Propietario"
              : "Vendedor en esta cuenta";
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
                      ? `Tú · ${roleLabel}${tenantContext.user.email ? ` · ${tenantContext.user.email}` : ""}`
                      : roleLabel}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Varios vendedores pueden registrar ventas en la misma cuenta desde sus
          propios teléfonos. Comparte el enlace de invitación para agregar
          miembros al equipo.
        </p>
      </section>

      <section className="mt-5">
        {signOutBlockedExplanation ? (
          <p
            className={cn(
              "mb-3 text-xs leading-relaxed",
              gate.blocker === "sync-failures"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {signOutBlockedExplanation}
          </p>
        ) : null}
        {signOutError ? (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {signOutError}
          </p>
        ) : null}
        <Button
          variant="outline"
          size="lg"
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut || !canSwitchTenant}
          className="w-full"
        >
          {signingOut
            ? "Cerrando sesión…"
            : signOutError
              ? "Reintentar limpieza y cerrar sesión"
              : "Cerrar sesión"}
        </Button>
      </section>
    </section>
  );
}
