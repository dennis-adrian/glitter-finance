/**
 * A centered card with a title, an explanation and one action, for screens
 * shown instead of the app: an invalid invitation, an unknown route or an
 * error the route could not recover from.
 */
export function StatusScreen({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-[420px] rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-3 text-sm leading-snug text-muted-foreground">
          {description}
        </p>
        {children}
      </section>
    </main>
  );
}

/** For the StatusScreen action, whether it is a link or a button. */
export const statusScreenActionClassName =
  "mt-5 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary px-4 text-base font-medium text-primary-foreground";
