"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { createInvitation, revokeInvitation } from "@/app/invitations/actions";
import { Button } from "@/components/ui/button";
import { isInvitationValid } from "@/lib/invitations/repository";
import type { TenantInvitation } from "@/lib/types";

type InviteTeamCardProps = {
  initialInvitation: TenantInvitation | null;
  origin: string;
  onInvitationChange?: (invitation: TenantInvitation | null) => void;
};

function formatAbsoluteExpiry(expiresAt: string) {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiresAt));
}

// Both expiry formatters run only after mount (relative depends on `Date.now()`,
// absolute on the runtime time zone), so neither causes an SSR/hydration
// mismatch — see the `mounted` gate in the render.
function formatRelativeExpiry(expiresAt: string): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return "Caducado";
  }
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (ms >= 86_400_000) {
    const days = Math.round(ms / 86_400_000);
    return `Caduca ${rtf.format(days, "day")}`;
  }
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `Caduca ${rtf.format(hours, "hour")}`;
}

export function InviteTeamCard({
  initialInvitation,
  origin,
  onInvitationChange,
}: InviteTeamCardProps) {
  const [invitation, setInvitation] = useState(initialInvitation);
  const [inviteLink, setInviteLink] = useState(
    initialInvitation?.token
      ? `${origin}/join/${initialInvitation.token}`
      : ""
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCanShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function"
    );
  }, []);

  useEffect(() => {
    if (!invitation || isInvitationValid(invitation)) {
      return;
    }

    setInvitation(null);
    setInviteLink("");
    onInvitationChange?.(null);
  }, [invitation, onInvitationChange]);

  useEffect(() => {
    if (!invitation) {
      return;
    }

    const ms = new Date(invitation.expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setInvitation(null);
      setInviteLink("");
      onInvitationChange?.(null);
    }, ms);

    return () => window.clearTimeout(timer);
  }, [invitation, onInvitationChange]);

  const relativeExpiry =
    mounted && invitation ? formatRelativeExpiry(invitation.expiresAt) : null;

  const isShareable =
    invitation !== null &&
    Boolean(inviteLink) &&
    isInvitationValid(invitation);
  const needsRotation =
    invitation !== null && isInvitationValid(invitation) && !inviteLink;

  async function handleGenerate() {
    setError(null);
    setIsGenerating(true);
    try {
      const result = await createInvitation();
      setInvitation(result.invitation);
      setInviteLink(result.link);
      onInvitationChange?.(result.invitation);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo generar el enlace de invitación."
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRevoke() {
    if (!invitation) {
      return;
    }
    setError(null);
    setIsRevoking(true);
    try {
      await revokeInvitation(invitation.id);
      setInvitation(null);
      setInviteLink("");
      onInvitationChange?.(null);
      setConfirmingRevoke(false);
      setCopied(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo revocar el enlace de invitación."
      );
    } finally {
      setIsRevoking(false);
    }
  }

  async function handleCopy() {
    if (!inviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No se pudo copiar el enlace.");
    }
  }

  async function handleShare() {
    if (!inviteLink) {
      return;
    }
    try {
      await navigator.share({
        title: "Únete a mi equipo en Glitter POS",
        text: "Te invito a registrar ventas en mi cuenta de Glitter POS:",
        url: inviteLink,
      });
    } catch (err) {
      // The user dismissing the share sheet rejects with AbortError — not a
      // real failure, so don't surface it.
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError("No se pudo compartir el enlace.");
    }
  }

  const isBusy = isGenerating || isRevoking;

  return (
    <section className="mb-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex items-center gap-2">
        <Link2 className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Invitar al equipo</h2>
      </div>
      <p className="mb-4 text-sm leading-snug text-muted-foreground">
        Cualquiera con este enlace puede unirse hasta que lo revoques o caduque.
        Compártelo por WhatsApp, email o el canal que prefieras.
      </p>
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      {isShareable && invitation ? (
        <div className="grid gap-3">
          <p className="break-all rounded-xl bg-muted px-3 py-2.5 text-sm">
            {inviteLink}
          </p>
          {mounted ? (
            <p className="text-xs text-muted-foreground">
              {relativeExpiry ? `${relativeExpiry} · ` : "Caduca el "}
              {formatAbsoluteExpiry(invitation.expiresAt)}
            </p>
          ) : null}

          {confirmingRevoke ? (
            <div className="grid gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-muted-foreground">
                ¿Revocar este enlace? Quienes ya lo tengan dejarán de poder
                unirse.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setConfirmingRevoke(false)}
                  disabled={isRevoking}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="rounded-2xl"
                  onClick={() => void handleRevoke()}
                  disabled={isRevoking}
                >
                  {isRevoking ? "Revocando…" : "Sí, revocar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              {canShare ? (
                <Button
                  type="button"
                  className="w-full rounded-2xl"
                  onClick={() => void handleShare()}
                  disabled={isBusy}
                >
                  <Share2 className="size-4" />
                  Compartir
                </Button>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => void handleCopy()}
                  disabled={isBusy}
                >
                  {copied ? (
                    <>
                      <Check className="size-4" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" />
                      Copiar
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setConfirmingRevoke(true)}
                  disabled={isBusy}
                >
                  Revocar
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : needsRotation ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Ya hay un enlace activo, pero no se puede mostrar de nuevo. Revócalo
            para generar uno nuevo.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-2xl"
            onClick={() => setConfirmingRevoke(true)}
            disabled={isBusy}
          >
            Revocar enlace activo
          </Button>
          {confirmingRevoke ? (
            <div className="grid gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-muted-foreground">
                ¿Revocar este enlace? Quienes ya lo tengan dejarán de poder
                unirse.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setConfirmingRevoke(false)}
                  disabled={isRevoking}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="rounded-2xl"
                  onClick={() => void handleRevoke()}
                  disabled={isRevoking}
                >
                  {isRevoking ? "Revocando…" : "Sí, revocar"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <Button
          type="button"
          className="w-full rounded-2xl"
          onClick={() => void handleGenerate()}
          disabled={isBusy}
        >
          {isGenerating ? "Generando…" : "Generar enlace de invitación"}
        </Button>
      )}
    </section>
  );
}
