"use client";

import { useState, type ReactNode } from "react";
import {
  BarChart3,
  Check,
  ChevronRight,
  Loader2,
  LogOut,
  Settings,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { createTenant, switchTenant } from "@/app/tenants/actions";
import { BrandMark } from "@/components/atoms/brand-mark";
import { usePowerSyncControls } from "@/components/providers/powersync-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signOutAfterLocalTeardown } from "@/lib/auth/client-logout";
import type { UserTenantContext } from "@/lib/auth/user-context";
import { isPowerSyncConfigured } from "@/lib/env";
import { useSyncStatus } from "@/lib/powersync/use-sync-status";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type MoreScreenProps = {
  tenantContext: UserTenantContext;
  openReports: () => void;
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

export function MoreScreen({
  tenantContext,
  openReports,
  openSettings,
}: MoreScreenProps) {
  const identity =
    tenantContext.user.displayName ||
    tenantContext.user.email ||
    "Billetera Ferial";
  const initials = identity.slice(0, 2).toUpperCase();
  const powerSyncControls = usePowerSyncControls();
  const {
    state: syncState,
    pendingCount: syncPendingCount,
    failureCount: syncFailureCount,
  } = useSyncStatus();
  const canSwitchTenant =
    !isPowerSyncConfigured() ||
    (syncState === "synced" &&
      syncPendingCount === 0 &&
      syncFailureCount === 0);
  const [switchingTenantId, setSwitchingTenantId] = useState<string | null>(
    null
  );
  const [showCreatePrompt, setShowCreatePrompt] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refreshTenantSessionAndReload() {
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;
    } catch (error) {
      console.error("[tenant-change] refreshSession failed", error);
      setActionError(
        "La sesión no se actualizó. Cierra sesión y vuelve a entrar, o recarga la página."
      );
      return false;
    }
    window.location.assign("/");
    return true;
  }

  async function teardownForTenantChange() {
    if (!powerSyncControls) {
      throw new Error("La limpieza local aún no está disponible.");
    }
    await powerSyncControls.teardownForTenantChange();
  }

  async function handleTenantSwitch(tenantId: string) {
    if (
      switchingTenantId ||
      tenantId === tenantContext.tenant?.id ||
      !canSwitchTenant
    ) {
      return;
    }

    setActionError(null);
    setSwitchingTenantId(tenantId);
    try {
      await teardownForTenantChange();
    } catch (error) {
      console.error("[switchTenant] local teardown failed", error);
      setActionError(
        error instanceof Error ? error.message : "No se pudo cambiar de puesto."
      );
      setSwitchingTenantId(null);
      return;
    }

    try {
      await switchTenant(tenantId);
    } catch (error) {
      console.error("[switchTenant] failed", error);
      setActionError(
        error instanceof Error ? error.message : "No se pudo cambiar de puesto."
      );
      setSwitchingTenantId(null);
      return;
    }

    if (!(await refreshTenantSessionAndReload())) {
      setSwitchingTenantId(null);
    }
  }

  async function handleCreateTenant() {
    const trimmedName = newTenantName.trim();
    if (!trimmedName || creatingTenant || !canSwitchTenant) return;

    setActionError(null);
    setCreatingTenant(true);
    try {
      await teardownForTenantChange();
    } catch (error) {
      console.error("[createTenant] local teardown failed", error);
      setActionError(
        error instanceof Error ? error.message : "No se pudo crear el puesto."
      );
      setCreatingTenant(false);
      return;
    }

    try {
      await createTenant(trimmedName);
    } catch (error) {
      console.error("[createTenant] failed", error);
      setActionError(
        error instanceof Error ? error.message : "No se pudo crear el puesto."
      );
      setCreatingTenant(false);
      return;
    }

    if (!(await refreshTenantSessionAndReload())) {
      setCreatingTenant(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setActionError(null);
    if (syncFailureCount > 0) {
      setActionError(
        "Hay operaciones que no llegaron a la nube. Abre Diagnósticos desde Ajustes antes de cerrar sesión."
      );
      return;
    }
    if (!canSwitchTenant) {
      setActionError(
        "Espera a que termine la sincronización antes de cerrar sesión."
      );
      return;
    }

    setSigningOut(true);
    try {
      if (!powerSyncControls) {
        throw new Error("La limpieza local aún no está disponible.");
      }
      await signOutAfterLocalTeardown(
        () => powerSyncControls.teardownForLogout(),
        signOut
      );
    } catch (error) {
      console.error("[signOut] signOut failed", error);
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudieron eliminar los datos locales."
      );
      setSigningOut(false);
    }
  }

  const overlayLabel = creatingTenant
    ? "Creando tu puesto…"
    : switchingTenantId
      ? "Cambiando de puesto…"
      : null;

  return (
    <section className="screen more-screen">
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

      <header className="mb-4 flex h-12 items-center gap-2.5">
        <BrandMark size="small" />
        <h1 className="font-heading text-[22px] font-extrabold">
          Billetera Ferial
        </h1>
      </header>

      <section className="overflow-hidden rounded-3xl border border-primary/10 bg-card shadow-[0_4px_12px_rgba(45,27,20,0.06)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.18)]">
        <button
          type="button"
          onClick={openSettings}
          className="flex w-full items-center gap-3.5 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-base font-bold">
              {identity}
            </strong>
            <small className="block truncate text-[13px] text-muted-foreground">
              {tenantContext.user.email ?? "Usuario autenticado"}
            </small>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
        </button>

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
                  onClick={() => void handleTenantSwitch(tenant.id)}
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
                    onClick={() => void handleCreateTenant()}
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

      {actionError ? (
        <p
          className="mt-3 text-sm leading-relaxed text-destructive"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-3xl border border-primary/10 bg-card shadow-[0_4px_12px_rgba(45,27,20,0.06)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.18)]">
        <MenuItem
          icon={<BarChart3 className="size-6" />}
          title="Reportes"
          description="Revisá tus ventas y estadísticas"
          onClick={openReports}
        />
        <MenuItem
          icon={<Settings className="size-6" />}
          title="Ajustes"
          description="Configurá tu cuenta y preferencias"
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
          title={signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
          description="Salí de tu cuenta"
          onClick={() => void handleSignOut()}
          danger
          disabled={signingOut}
        />
      </section>
    </section>
  );
}
