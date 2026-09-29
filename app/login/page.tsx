import Link from "next/link";
import { BarChart2, CheckCircle2, WifiOff } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { AuthForm } from "@/components/molecules/auth-form";
import {
  AuthFormError,
  AuthFormStatus,
} from "@/components/molecules/auth-form-fields";
import { PasswordResetRequestForm } from "@/components/molecules/password-reset-request-form";
import {
  AuthPageHeader,
  AuthPageShell,
} from "@/components/templates/auth-page-shell";
import {
  loginErrorMessage,
  loginStatusMessage,
  type LoginMode,
} from "@/lib/auth/login-messages";
import { resolveAuthRedirectPath } from "@/lib/auth/oauth";
import { getRequestOrigin } from "@/lib/request-origin";
import { cn } from "@/lib/utils";

type AuthMode = "welcome" | LoginMode;

const screenTitles: Record<LoginMode, string> = {
  signin: "Iniciar Sesión",
  signup: "Crear Cuenta",
  reset: "Recuperar Contraseña",
};

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    message?: string | string[];
    mode?: string | string[];
    next?: string | string[];
  }>;
};

const benefits = [
  {
    icon: CheckCircle2,
    title: "Cobrá sin fricción",
    description: "Registrá pagos por efectivo o QR al instante",
    tone: "bg-muted text-primary",
  },
  {
    icon: WifiOff,
    title: "Vendé incluso sin señal",
    description: "Modo offline que sincroniza cuando vuelve la conexión",
    tone: "bg-secondary/10 text-secondary",
  },
  {
    icon: BarChart2,
    title: "Mirá tus ventas al instante",
    description: "Reportes en tiempo real",
    tone: "bg-muted text-primary",
  },
];

function firstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function parseLoginMode(value?: string): LoginMode | null {
  return value === "signin" || value === "signup" || value === "reset"
    ? value
    : null;
}

function authHref(mode: AuthMode, next: string) {
  const search = new URLSearchParams();
  if (mode !== "welcome") search.set("mode", mode);
  if (next !== "/") search.set("next", next);
  const query = search.toString();
  return query ? `/login?${query}` : "/login";
}

function WelcomeScreen({ next }: { next: string }) {
  return (
    <div className="flex min-h-full flex-1 flex-col justify-between">
      <div>
        <header className="flex flex-col items-center gap-5 px-6 pt-[max(28px,env(safe-area-inset-top))] pb-5 text-center">
          <div className="flex flex-col items-center gap-3">
            <span className="grid size-[88px] place-items-center rounded-3xl border border-primary/12 bg-muted [&>img]:size-16!">
              <BrandMark />
            </span>
            <p className="font-heading text-[22px] leading-[26px] font-extrabold text-foreground">
              Billetera Ferial
            </p>
          </div>
          <h1 className="font-heading max-w-[354px] text-[32px] leading-[1.15] font-extrabold text-foreground">
            Tu punto de venta para cada feria
          </h1>
        </header>

        <ul className="grid gap-7 px-6 py-3" aria-label="Beneficios">
          {benefits.map(({ icon: Icon, title, description, tone }) => (
            <li key={title} className="flex items-center gap-4">
              <span
                className={cn(
                  "grid size-12 shrink-0 place-items-center rounded-2xl",
                  tone
                )}
              >
                <Icon aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-base leading-5 font-bold text-foreground">
                  {title}
                </p>
                <p className="mt-0.5 text-sm leading-[18px] text-foreground/70">
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 px-6 pt-6 pb-[max(24px,env(safe-area-inset-bottom))]">
        <Link
          href={authHref("signin", next)}
          className="flex h-[52px] items-center justify-center rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-[0_4px_6px] shadow-primary/15 transition-colors hover:bg-[var(--interactive-hover)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring/40"
        >
          Iniciar Sesión
        </Link>
        <Link
          href={authHref("signup", next)}
          className="flex h-[52px] items-center justify-center rounded-2xl border-[1.5px] border-primary text-base font-bold text-primary transition-colors hover:bg-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring/40"
        >
          Crear Cuenta
        </Link>
      </div>
    </div>
  );
}

function AuthScreen({
  mode,
  next,
  error,
  message,
}: {
  mode: LoginMode;
  next: string;
  error?: string;
  message?: string;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AuthPageHeader
        title={screenTitles[mode]}
        backHref={authHref(mode === "reset" ? "signin" : "welcome", next)}
      />

      <div className="flex flex-1 flex-col px-6">
        {error ? <AuthFormError>{error}</AuthFormError> : null}
        {message ? <AuthFormStatus>{message}</AuthFormStatus> : null}

        {mode === "reset" ? (
          <PasswordResetRequestForm
            next={next}
            signInHref={authHref("signin", next)}
          />
        ) : (
          <AuthForm
            mode={mode}
            next={next}
            alternateHref={authHref(
              mode === "signup" ? "signin" : "signup",
              next
            )}
            passwordResetHref={authHref("reset", next)}
          />
        )}
      </div>
    </div>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const origin = await getRequestOrigin();
  const next = resolveAuthRedirectPath(firstValue(params.next) ?? null, origin);
  // Codes only: unknown values (or free text) show nothing.
  const error = loginErrorMessage(firstValue(params.error)) ?? undefined;
  const message = loginStatusMessage(firstValue(params.message)) ?? undefined;
  const mode: AuthMode =
    parseLoginMode(firstValue(params.mode)) ??
    (error || message ? "signin" : "welcome");

  return (
    <AuthPageShell>
      {mode === "welcome" ? (
        <WelcomeScreen next={next} />
      ) : (
        <AuthScreen mode={mode} next={next} error={error} message={message} />
      )}
    </AuthPageShell>
  );
}
