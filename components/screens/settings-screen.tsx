"use client";

import { useState, type ReactNode } from "react";
import { Stethoscope } from "lucide-react";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { Screen } from "@/components/templates/screen";
import { DeleteAccountCard } from "@/components/molecules/delete-account-card";
import { InviteTeamCard } from "@/components/molecules/invite-team-card";
import { SettingsItem } from "@/components/molecules/settings-item";
import { TeamMembersCard } from "@/components/molecules/team-members-card";
import { ThemePicker } from "@/components/molecules/theme-picker";
import type { UserTenantContext } from "@/lib/auth/tenant-context";
import type { TenantInvitation, TenantMember } from "@/lib/types";

type SettingsScreenProps = {
  tenantContext: UserTenantContext;
  tenantMembers: TenantMember[];
  teamSyncPending?: boolean;
  activeInvitation: TenantInvitation | null;
  inviteOrigin: string;
  onInvitationChange?: (invitation: TenantInvitation | null) => void;
  onMemberRemoved?: (member: TenantMember) => void;
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
  onMemberRemoved,
  openDiagnostics,
  back,
}: SettingsScreenProps) {
  const tenantName = tenantContext.tenant?.name;
  const [inviteCardRevision, setInviteCardRevision] = useState(0);

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
          <TeamMembersCard
            tenantId={tenantContext.tenant.id}
            tenantName={tenantContext.tenant.name}
            createdByUserId={tenantContext.tenant.createdByUserId}
            currentUserId={tenantContext.user.id}
            currentUserEmail={tenantContext.user.email}
            members={tenantMembers}
            teamSyncPending={teamSyncPending}
            onMemberRemoved={(member) => {
              // Removing someone revokes the link; the card shows none now.
              setInviteCardRevision((revision) => revision + 1);
              onInvitationChange?.(null);
              onMemberRemoved?.(member);
            }}
          />
          <InviteTeamCard
            key={inviteCardRevision}
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

      <SettingsSection id="settings-account" title="Cuenta">
        <DeleteAccountCard activeTenantId={tenantContext.tenant?.id ?? null} />
      </SettingsSection>
    </Screen>
  );
}
