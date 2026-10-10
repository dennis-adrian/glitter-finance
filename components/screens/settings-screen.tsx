"use client";

import type { ReactNode } from "react";
import { Stethoscope } from "lucide-react";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { Screen } from "@/components/templates/screen";
import { InviteTeamCard } from "@/components/molecules/invite-team-card";
import { SettingsItem } from "@/components/molecules/settings-item";
import { ThemePicker } from "@/components/molecules/theme-picker";
import type { UserTenantContext } from "@/lib/auth/tenant-context";
import type { TenantInvitation, TenantMember } from "@/lib/types";
import { initialsOf } from "@/lib/utils";

type SettingsScreenProps = {
  tenantContext: UserTenantContext;
  tenantMembers: TenantMember[];
  teamSyncPending?: boolean;
  activeInvitation: TenantInvitation | null;
  inviteOrigin: string;
  onInvitationChange?: (invitation: TenantInvitation | null) => void;
  openDiagnostics: () => void;
  back: () => void;
};

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div>
        <h2 id={id} className="text-base font-bold">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Settings for the active puesto and this device. Account and puesto
 * switching, and signing out, live in Más; on-device record counts live in
 * Diagnósticos.
 */
export function SettingsScreen({
  tenantContext,
  tenantMembers,
  teamSyncPending = false,
  activeInvitation,
  inviteOrigin,
  onInvitationChange,
  openDiagnostics,
  back,
}: SettingsScreenProps) {
  const tenantName = tenantContext.tenant?.name;

  return (
    <Screen
      width="narrow"
      header={<ScreenHeader title="Ajustes" onBack={back} />}
      bodyClassName="grid gap-8"
    >
      {tenantContext.tenant ? (
        <SettingsSection
          id="settings-team"
          title="Equipo"
          description={
            tenantName
              ? `Quiénes pueden registrar ventas en ${tenantName}.`
              : undefined
          }
        >
          <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
            {teamSyncPending ? (
              <p className="mb-3 text-sm leading-snug text-muted-foreground">
                Sincronizando el equipo… Si esto persiste, revisá la conexión en
                Diagnósticos.
              </p>
            ) : null}
            <ul className="grid">
              {tenantMembers.map((member) => {
                const isCurrentUser = member.userId === tenantContext.user.id;
                const isOwner =
                  tenantContext.tenant?.createdByUserId != null &&
                  member.userId === tenantContext.tenant.createdByUserId;
                const roleLabel = isOwner ? "Propietario" : "Vendedor";
                const memberInitials = initialsOf(member.displayName);
                return (
                  <li
                    className="flex items-center gap-3 border-b border-border py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                    key={member.id}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {memberInitials}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">
                        {member.displayName}
                        {isCurrentUser ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            (vos)
                          </span>
                        ) : null}
                      </strong>
                      <small className="block truncate text-xs text-muted-foreground">
                        {roleLabel}
                        {isCurrentUser && tenantContext.user.email
                          ? ` · ${tenantContext.user.email}`
                          : ""}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <InviteTeamCard
            tenantId={tenantContext.tenant.id}
            initialInvitation={activeInvitation}
            origin={inviteOrigin}
            onInvitationChange={onInvitationChange}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection
        id="settings-appearance"
        title="Apariencia"
        description="Se guarda en este dispositivo."
      >
        <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
          <ThemePicker />
        </div>
      </SettingsSection>

      <SettingsSection id="settings-support" title="Soporte">
        <SettingsItem
          icon={<Stethoscope size={21} />}
          label="Diagnósticos"
          value="Sincronización, datos y dispositivo"
          onClick={openDiagnostics}
        />
      </SettingsSection>
    </Screen>
  );
}
