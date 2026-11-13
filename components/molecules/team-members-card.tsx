"use client";

import { useState } from "react";
import { DoorOpen, Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { removeTenantMember } from "@/app/tenants/actions";
import { ConfirmDialog } from "@/components/molecules/confirm-dialog";
import { ReloadAppButton } from "@/components/molecules/reload-app-button";
import { Button } from "@/components/ui/button";
import { unwrapActionResult } from "@/lib/action-result";
import { memberActionFor, resolveTenantOwnerId } from "@/lib/auth/tenant-owner";
import { useTenantSessionActions } from "@/lib/auth/use-tenant-session-actions";
import { describeLocalDataChangeBlocker } from "@/lib/powersync/local-data-gate";
import type { TenantMember } from "@/lib/types";
import { initialsOf } from "@/lib/utils";

const REMOVE_FAILED_MESSAGE = "No se pudo quitar a esa persona del puesto.";

type TeamMembersCardProps = {
  /** The tenant this screen renders; the server refuses any other. */
  tenantId: string;
  tenantName: string;
  createdByUserId: string | null;
  currentUserId: string;
  currentUserEmail: string | null;
  /** In joining order. */
  members: TenantMember[];
  teamSyncPending: boolean;
  /** After the server removed `member` (and revoked the invite link). */
  onMemberRemoved?: (member: TenantMember) => void;
};

/**
 * The puesto's team. Its creator can remove the others, and everyone else
 * can leave; the server enforces the same rules (lib/auth/tenant-owner.ts).
 * Leaving clears this device's data like a switch, so it waits for the sync
 * to settle.
 */
export function TeamMembersCard({
  tenantId,
  tenantName,
  createdByUserId,
  currentUserId,
  currentUserEmail,
  members,
  teamSyncPending,
  onMemberRemoved,
}: TeamMembersCardProps) {
  const ownerId = resolveTenantOwnerId(createdByUserId, members);
  const isOwner = ownerId === currentUserId;
  const canLeave =
    memberActionFor({
      actorUserId: currentUserId,
      ownerUserId: ownerId,
      memberUserId: currentUserId,
    }) === "leave";
  const { gate, busy, leavingTenant, error, leaveTenant } =
    useTenantSessionActions({
      activeTenantId: tenantId,
      copy: {
        switchFailed: "No se pudo cambiar de puesto.",
        createFailed: "No se pudo crear el puesto.",
      },
    });
  const [memberToRemove, setMemberToRemove] = useState<TenantMember | null>(
    null
  );
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function remove(member: TenantMember) {
    if (removingUserId) return;
    setRemovingUserId(member.userId);
    try {
      await unwrapActionResult(
        () => removeTenantMember(tenantId, member.userId),
        REMOVE_FAILED_MESSAGE
      );
      toast.success(`${member.displayName} ya no es parte del puesto.`);
      onMemberRemoved?.(member);
    } catch (removeError) {
      toast.error(
        removeError instanceof Error && removeError.message
          ? removeError.message
          : REMOVE_FAILED_MESSAGE
      );
    } finally {
      setRemovingUserId(null);
    }
  }

  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      {teamSyncPending ? (
        <p className="mb-3 text-sm leading-snug text-muted-foreground">
          Sincronizando el equipo… Si esto persiste, revisá la conexión en
          Diagnósticos.
        </p>
      ) : null}
      <ul className="grid">
        {members.map((member) => {
          const isCurrentUser = member.userId === currentUserId;
          const roleLabel =
            member.userId === ownerId ? "Propietario" : "Vendedor";
          const action = memberActionFor({
            actorUserId: currentUserId,
            ownerUserId: ownerId,
            memberUserId: member.userId,
          });
          return (
            <li
              className="flex items-center gap-3 border-b border-border py-2.5 first:pt-0 last:border-b-0 last:pb-0"
              key={member.id}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {initialsOf(member.displayName)}
              </span>
              <span className="min-w-0 flex-1">
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
                  {isCurrentUser && currentUserEmail
                    ? ` · ${currentUserEmail}`
                    : ""}
                </small>
              </span>
              {action === "remove" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive"
                  disabled={removingUserId !== null}
                  aria-label={`Quitar a ${member.displayName} del puesto`}
                  onClick={() => setMemberToRemove(member)}
                >
                  {removingUserId === member.userId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserMinus className="size-4" />
                  )}
                  Quitar
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {isOwner && members.length > 1 ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Como creaste el puesto, podés quitar a otros miembros. Quitar a
          alguien también desactiva el enlace de invitación activo.
        </p>
      ) : null}

      {canLeave ? (
        <div className="mt-4 grid gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            className="w-fit text-destructive"
            disabled={busy || !gate.canChange}
            onClick={() => setConfirmLeave(true)}
          >
            {leavingTenant ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <DoorOpen className="size-4" />
            )}
            {leavingTenant ? "Saliendo del puesto…" : "Salir del puesto"}
          </Button>
          {gate.blocker ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {describeLocalDataChangeBlocker(gate.blocker, {
                pendingCount: gate.pendingCount,
                uploadHold: gate.uploadHold,
                action: "salir del puesto",
              })}
            </p>
          ) : null}
          {gate.blocker === "tenant-changed" ? <ReloadAppButton /> : null}
          {error?.action === "leave" ? (
            <p
              className="text-xs leading-relaxed text-destructive"
              role="alert"
            >
              {error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={memberToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
        title={`¿Quitar a ${memberToRemove?.displayName ?? ""}?`}
        description={`Va a dejar de ver ${tenantName} en todos sus dispositivos. Las ventas y los conteos de stock que registró se conservan con su nombre. El enlace de invitación activo se desactiva: si querés sumar a alguien más, generá uno nuevo.`}
        confirmLabel="Quitar"
        tone="destructive"
        icon={<UserMinus className="size-5" />}
        onConfirm={() => {
          if (memberToRemove) void remove(memberToRemove);
        }}
      />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={`¿Salir de ${tenantName}?`}
        description="Vas a dejar de ver este puesto en todos tus dispositivos, y sus datos se borran de este. Las ventas que registraste se conservan en el puesto. Para volver, vas a necesitar un enlace de invitación nuevo."
        confirmLabel="Salir"
        tone="destructive"
        icon={<DoorOpen className="size-5" />}
        onConfirm={() => void leaveTenant()}
      />
    </div>
  );
}
