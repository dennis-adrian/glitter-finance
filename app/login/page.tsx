import { signInWithPassword, signUpWithPassword } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { getRequestOrigin } from "@/lib/request-origin";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const origin = await getRequestOrigin();
  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = origin
    ? sanitizeRedirectPath(nextRaw ?? null, origin)
    : "/";

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-[420px] rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
        <span className="brand-mark">G</span>
        <h1 className="mt-2 text-2xl font-bold text-primary">Glitter POS</h1>
        <p className="mt-2 mb-4 leading-snug text-muted-foreground">
          Ingresa con tu cuenta de prueba para sincronizar catálogo y ventas con
          Supabase.
        </p>
        {params.error ? (
          <div className="mb-3.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {params.error}
          </div>
        ) : null}
        {params.message ? (
          <div className="mb-3.5 rounded-xl border border-[var(--green)]/30 bg-[var(--green)]/10 px-3 py-2.5 text-sm text-[var(--green)]">
            {params.message}
          </div>
        ) : null}
        <form action={signInWithPassword} className="mt-4 grid gap-3">
          <input type="hidden" name="next" value={next} />
          <Label className="grid gap-1.5">
            Email
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-12 rounded-xl"
            />
          </Label>
          <Label className="grid gap-1.5">
            Contraseña
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-12 rounded-xl"
            />
          </Label>
          <Button size="lg" type="submit" className="rounded-2xl">
            Iniciar sesión
          </Button>
        </form>
        <form
          action={signUpWithPassword}
          className="mt-6 grid gap-3 border-t border-border pt-5"
        >
          <input type="hidden" name="next" value={next} />
          <Label className="grid gap-1.5">
            Nombre
            <Input
              name="displayName"
              autoComplete="name"
              className="h-12 rounded-xl"
            />
          </Label>
          <Label className="grid gap-1.5">
            Email
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-12 rounded-xl"
            />
          </Label>
          <Label className="grid gap-1.5">
            Contraseña
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              className="h-12 rounded-xl"
            />
          </Label>
          <Button
            variant="outline"
            size="lg"
            type="submit"
            className="rounded-2xl"
          >
            Crear cuenta de prueba
          </Button>
        </form>
      </section>
    </main>
  );
}
