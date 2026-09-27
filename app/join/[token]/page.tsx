import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinTenantForm } from "@/components/molecules/join-tenant-form";
import { PowerSyncProvider } from "@/components/providers/powersync-provider";
import {
  getInvitationByToken,
  isInvitationValid,
} from "@/lib/invitations/repository";
import { buildLoginRedirectPath } from "@/lib/auth/oauth";
import { resolveUserTenantContext } from "@/lib/auth/user-context";

type JoinPageProps = {
  params: Promise<{
    token: string;
  }>;
};

function InvalidInvitationScreen() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-[420px] rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
        <h1 className="text-xl font-bold">Esta invitación ya no es válida</h1>
        <p className="mt-3 text-sm leading-snug text-muted-foreground">
          El enlace puede haber caducado o haber sido revocado. Pide un enlace
          nuevo a quien te invitó.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary px-4 text-base font-medium text-primary-foreground"
        >
          Ir a Billetera Ferial
        </Link>
      </section>
    </main>
  );
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { token } = await params;
  const invitation = await getInvitationByToken(token);

  if (!invitation || !isInvitationValid(invitation)) {
    return <InvalidInvitationScreen />;
  }

  // Read-only on purpose: a user invited before they had any tenant must end
  // up only in the inviter's tenant, so this render never bootstraps one.
  const context = await resolveUserTenantContext();
  if (!context) {
    redirect(buildLoginRedirectPath({}, `/join/${token}`));
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-[420px] rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
        <h1 className="text-2xl font-bold text-primary">Unirte al equipo</h1>
        <p className="mt-3 leading-snug text-muted-foreground">
          Vas a unirte a <strong>{invitation.tenantName}</strong> con tu cuenta{" "}
          {context.user.email ? (
            <>
              <strong>{context.user.email}</strong>
            </>
          ) : (
            "actual"
          )}
          .
        </p>
        {/* Only a tenant the session's claim already names: that is the one
            PowerSync would sync here. Without one (no membership yet, or a
            claim only '/' can repair) the provider syncs nothing. */}
        <PowerSyncProvider
          identity={{
            userId: context.user.id,
            tenantId: context.claimedTenantId,
            email: context.user.email,
          }}
          loadingLayout="parent"
        >
          <JoinTenantForm token={token} />
        </PowerSyncProvider>
      </section>
    </main>
  );
}
