"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Loader2, LogOut, Settings } from "lucide-react";
import { ReloadAppButton } from "@/components/molecules/reload-app-button";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { Screen } from "@/components/templates/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useTenantSessionActions,
  type TenantSessionCopy,
} from "@/lib/auth/use-tenant-session-actions";
import type { UserTenantContext } from "@/lib/auth/tenant-context";
import {
  pendingUploadsBlockerMessage,
  tenantChangedBlockerMessage,
  type LocalDataChangeBlocker,
} from "@/lib/powersync/local-data-gate";
import type { UploadHold } from "@/lib/powersync/upload-holds";
import { cn, initialsOf } from "@/lib/utils";

const tenantSessionCopy: TenantSessionCopy = {
  switchFailed: "No se pudo cambiar de puesto.",
  createFailed: "No se pudo crear el puesto.",
};

function describeBlocker(
  blocker: LocalDataChangeBlocker,
  pendingCount: number,
  uploadHold: UploadHold | null
) {
  switch (blocker) {
    case "sync-failures":
      return "Hay operaciones que no llegaron a la nube. Abrí Diagnósticos desde Ajustes, copiá el diagnóstico y resolvelas antes de cambiar de puesto o cerrar sesión.";
    case "tenant-changed":
      return tenantChangedBlockerMessage("cambiar de puesto o cerrar sesión");
    case "pending-uploads":
      return pendingUploadsBlockerMessage(
        pendingCount,
        "cambiar de puesto o cerrar sesión",
        uploadHold
      );
    case "not-synced":
      return "Esperá a que termine la sincronización antes de cambiar de puesto o cerrar sesión.";
  }
}

type MoreScreenProps = {
  tenantContext: UserTenantContext;
  openSettings: () => void;
};

type MenuItemProps = {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

function MenuItem({
  icon,
  title,
  description,
  onClick,
  danger = false,
  disabled = false,
}: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[72px] w-full items-center gap-3.5 border-b border-border p-4 text-left transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 disabled:opacity-60"
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          danger
            ? "bg-secondary/10 text-secondary"
            : "bg-primary/10 text-primary"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong
          className={cn(
            "block text-[15px] font-bold",
            danger && "text-secondary"
          )}
        >
          {title}
        </strong>
        <small className="block text-[13px] leading-4 text-muted-foreground">
          {description}
        </small>
      </span>
      {!danger ? (
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
}

export function MoreScreen({ tenantContext, openSettings }: MoreScreenProps) {
  const identity =
    tenantContext.user.displayName || tenantContext.user.email || null;
  const initials = initialsOf(identity);
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
  const [showCreatePrompt, setShowCreatePrompt] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const signOutFailed = actionError?.action === "sign-out";

  const overlayLabel = creatingTenant
    ? "Creando tu puesto…"
    : switchingTenantId
      ? "Cambiando de puesto…"
      : null;

  return (
    <Screen width="narrow" header={<ScreenHeader title="Más" />}>
      {overlayLabel ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-7 animate-spin text-primary" />
            <p className="text-sm font-medium">{overlayLabel}</p>
          </div>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-primary/10 bg-card shadow-[0_4px_12px_rgba(45,27,20,0.06)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.18)]">
        <div className="flex w-full items-center gap-3.5 p-4">
          <span
            className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-xl font-bold text-primary-foreground"
            aria-hidden
          >
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-base font-bold">
              {identity ?? "Billetera Ferial"}
            </strong>
            <small className="block truncate text-[13px] text-muted-foreground">
              {tenantContext.user.email ?? "Usuario autenticado"}
            </small>
          </span>
        </div>

        <div className="mx-4 border-t border-border pt-3 pb-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            Tus puestos
          </p>
          <div className="grid gap-2">
            {tenantContext.tenants.map((tenant) => {
              const isActive = tenant.id === tenantContext.tenant?.id;
              const isSwitching = tenant.id === switchingTenantId;
              return (
                <button
                  key={tenant.id}
                  type="button"
                  disabled={
                    isActive || !canSwitchTenant || Boolean(switchingTenantId)
                  }
                  onClick={() => void switchTenant(tenant.id)}
                  className={cn(
                    "flex min-h-11 items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted disabled:opacity-50"
                  )}
                >
                  <span>{tenant.name}</span>
                  {isActive ? (
                    <Check className="size-5 shrink-0" />
                  ) : isSwitching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                </button>
              );
            })}

            {showCreatePrompt ? (
              <div className="grid gap-2 rounded-xl border border-border p-3">
                <Label className="grid gap-1.5 text-sm">
                  Nombre del puesto
                  <Input
                    value={newTenantName}
                    onChange={(event) => setNewTenantName(event.target.value)}
                    placeholder="Ej. Puesto Central"
                    className="h-11 rounded-xl"
                    autoFocus
                  />
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
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
                    className="rounded-xl"
                    onClick={() => void createTenant(newTenantName)}
                    disabled={
                      creatingTenant ||
                      !newTenantName.trim() ||
                      !canSwitchTenant
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
                className="min-h-10 text-left text-sm font-bold text-primary transition-opacity disabled:opacity-50"
              >
                + Crear nuevo puesto
              </button>
            )}
          </div>
        </div>
      </section>

      {gate.blocker ? (
        <p
          className={cn(
            "mt-3 text-sm leading-relaxed",
            gate.blocker === "sync-failures"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
          role="status"
        >
          {describeBlocker(gate.blocker, gate.pendingCount, gate.uploadHold)}
        </p>
      ) : null}
      {gate.blocker === "tenant-changed" ? (
        <ReloadAppButton className="mt-2" />
      ) : null}

      {actionError ? (
        <p
          className="mt-3 text-sm leading-relaxed text-destructive"
          role="alert"
        >
          {actionError.message}
        </p>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-3xl border border-primary/10 bg-card shadow-[0_4px_12px_rgba(45,27,20,0.06)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.18)]">
        <MenuItem
          icon={<Settings className="size-6" />}
          title="Ajustes"
          description="Equipo, apariencia y diagnósticos"
          onClick={openSettings}
        />
        <MenuItem
          icon={
            signingOut ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <LogOut className="size-6" />
            )
          }
          title={
            signingOut
              ? "Cerrando sesión…"
              : signOutFailed
                ? "Reintentar limpieza y cerrar sesión"
                : "Cerrar sesión"
          }
          description="Salí de tu cuenta"
          onClick={() => void signOut()}
          danger
          disabled={signingOut || !canSwitchTenant}
        />
      </section>
    </Screen>
  );
}
