import { signInWithPassword, signUpWithPassword } from "@/app/auth/actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <span className="brand-mark auth-mark">G</span>
        <h1>Glitter POS</h1>
        <p>
          Ingresa con tu cuenta de prueba para sincronizar catálogo y ventas con
          Supabase.
        </p>
        {params.error ? <div className="auth-error">{params.error}</div> : null}
        <form action={signInWithPassword} className="auth-form">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary-action" type="submit">
            Iniciar sesión
          </button>
        </form>
        <form action={signUpWithPassword} className="auth-form auth-signup">
          <label>
            Nombre
            <input name="displayName" autoComplete="name" />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </label>
          <button className="secondary-action" type="submit">
            Crear cuenta de prueba
          </button>
        </form>
      </section>
    </main>
  );
}
