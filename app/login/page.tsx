import Link from "next/link";
import { BarChart2, CheckCircle2, ChevronLeft, WifiOff } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { AuthForm } from "@/components/molecules/auth-form";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { getRequestOrigin } from "@/lib/request-origin";
import { cn } from "@/lib/utils";

type AuthMode = "welcome" | "signin" | "signup";

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
    tone: "bg-[#ecf6f5] text-[#00786f]",
  },
  {
    icon: WifiOff,
    title: "Vendé incluso sin señal",
    description: "Modo offline que sincroniza cuando vuelve la conexión",
    tone: "bg-[#fdf0ed] text-[#e8725a]",
  },
  {
    icon: BarChart2,
    title: "Mirá tus ventas al instante",
    description: "Reportes en tiempo real",
    tone: "bg-[#ecf6f5] text-[#00786f]",
  },
];

function firstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
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
            <span className="grid size-[88px] place-items-center rounded-3xl border border-[#00786f]/12 bg-[#ecf6f5] [&>img]:size-16!">
              <BrandMark />
            </span>
            <p className="font-heading text-[22px] leading-[26px] font-extrabold text-[#1a2e2c]">
              Billetera Ferial
            </p>
          </div>
          <h1 className="font-heading max-w-[354px] text-[32px] leading-[1.15] font-extrabold text-[#1a2e2c]">
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
                <p className="text-base leading-5 font-bold text-[#1a2e2c]">
                  {title}
                </p>
                <p className="mt-0.5 text-sm leading-[18px] text-[#5a6b68]">
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
          className="flex h-[52px] items-center justify-center rounded-2xl bg-[#00786f] text-base font-bold text-white shadow-[0_4px_6px_rgba(0,120,111,0.15)] transition-colors hover:bg-[#0d564f] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#00786f]/40"
        >
          Iniciar Sesión
        </Link>
        <Link
          href={authHref("signup", next)}
          className="flex h-[52px] items-center justify-center rounded-2xl border-[1.5px] border-[#00786f] text-base font-bold text-[#00786f] transition-colors hover:bg-[#ecf6f5] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#00786f]/40"
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
  mode: Exclude<AuthMode, "welcome">;
  next: string;
  error?: string;
  message?: string;
}) {
  const isSignup = mode === "signup";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center gap-3 px-4 pt-[max(28px,env(safe-area-inset-top))] pb-6">
        <Link
          href={authHref("welcome", next)}
          aria-label="Volver"
          className="grid h-8 w-9 shrink-0 place-items-center rounded-full bg-[#f4efe6] text-[#1e2d2b] transition-colors hover:bg-[#e9e1d5] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#00786f]/40"
        >
          <ChevronLeft
            aria-hidden="true"
            className="size-4"
            strokeWidth={2.5}
          />
        </Link>
        <h1 className="font-heading text-[28px] leading-[34px] font-extrabold text-[#1e2d2b]">
          {isSignup ? "Crear Cuenta" : "Iniciar Sesión"}
        </h1>
      </header>

      <div className="flex flex-1 flex-col px-6">
        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-[#e8725a]/35 bg-[#fdf0ed] px-4 py-3 text-sm leading-snug text-[#8a3329]"
          >
            {error}
          </div>
        ) : null}
        {message ? (
          <div
            role="status"
            className="mb-4 rounded-xl border border-[#00786f]/25 bg-[#ecf6f5] px-4 py-3 text-sm leading-snug text-[#005f58]"
          >
            {message}
          </div>
        ) : null}

        <AuthForm
          mode={mode}
          next={next}
          alternateHref={authHref(isSignup ? "signin" : "signup", next)}
        />
      </div>
    </div>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const origin = await getRequestOrigin();
  const nextRaw = firstValue(params.next);
  const isRelativeNext =
    !!nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//");
  const next =
    origin || isRelativeNext
      ? sanitizeRedirectPath(nextRaw ?? null, origin || "http://localhost")
      : "/";
  const error = firstValue(params.error);
  const message = firstValue(params.message);
  const requestedMode = firstValue(params.mode);
  const mode: AuthMode =
    requestedMode === "signup"
      ? "signup"
      : requestedMode === "signin" || error || message
        ? "signin"
        : "welcome";

  return (
    <main className="grid min-h-dvh bg-[#f2f2f2] text-[#1a2e2c] sm:place-items-center sm:p-4">
      <section className="flex min-h-dvh w-full max-w-[402px] flex-col overflow-hidden bg-[#fffdf8] shadow-[0_16px_32px_rgba(45,27,20,0.06)] sm:h-[min(874px,calc(100dvh-32px))] sm:min-h-0 sm:rounded-[32px]">
        {mode === "welcome" ? (
          <WelcomeScreen next={next} />
        ) : (
          <AuthScreen mode={mode} next={next} error={error} message={message} />
        )}
      </section>
    </main>
  );
}
