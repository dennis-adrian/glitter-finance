export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-primary">
      <section className="w-full max-w-[420px] rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
        <h1 className="mb-2.5 text-2xl font-bold">Glitter POS</h1>
        <p className="leading-relaxed text-muted-foreground">
          No hay conexion. Abre la app una vez con internet para guardar el modo
          de venta en este dispositivo.
        </p>
      </section>
    </main>
  );
}
