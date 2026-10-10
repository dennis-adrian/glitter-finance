import { redirect } from "next/navigation";
import { UpdatePasswordForm } from "@/components/molecules/update-password-form";
import {
  AuthPageHeader,
  AuthPageShell,
} from "@/components/templates/auth-page-shell";
import { buildLoginRedirectPath } from "@/lib/auth/oauth";
import { resolvePasswordUpdateNext } from "@/lib/auth/password-reset";
import { getAuthenticatedUser } from "@/lib/auth/user-context";
import { getRequestOrigin } from "@/lib/request-origin";

type UpdatePasswordPageProps = {
  searchParams: Promise<{
    next?: string | string[];
  }>;
};

export default async function UpdatePasswordPage({
  searchParams,
}: UpdatePasswordPageProps) {
  const params = await searchParams;
  const origin = await getRequestOrigin();
  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = resolvePasswordUpdateNext(nextRaw ?? null, origin);

  // The recovery link (app/auth/confirm) signs the user in before sending
  // them here. Without a session the link expired or was never opened, so
  // the reset screen asks for a new one.
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect(
      buildLoginRedirectPath(
        { error: "password_reset_link_invalid", mode: "reset" },
        next
      )
    );
  }

  return (
    <AuthPageShell>
      <div className="flex min-h-full flex-1 flex-col">
        <AuthPageHeader title="Nueva Contraseña" />

        <div className="flex flex-1 flex-col px-6">
          <p className="pb-5 text-sm leading-snug text-foreground/70">
            Elegí una contraseña nueva para{" "}
            {user.email ? (
              <strong className="font-bold text-foreground">
                {user.email}
              </strong>
            ) : (
              "tu cuenta"
            )}
            .
          </p>
          <UpdatePasswordForm next={next} />
        </div>
      </div>
    </AuthPageShell>
  );
}
