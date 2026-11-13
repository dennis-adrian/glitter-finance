import Link from "next/link";
import { BrandMark } from "@/components/atoms/brand-mark";
import {
  isLegalPlaceholder,
  legalOperator,
  legalPlaceholdersLeft,
  type LegalOperatorField,
} from "@/lib/legal/operator";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/paths";

const linkClassName =
  "font-semibold text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring/40";

/**
 * A public, signed-out page of long-form text (the terms and the privacy
 * policy): one readable column on the app background, with the brand on top
 * and links to the other legal page and back to the app at the bottom.
 */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  const draft = legalPlaceholdersLeft().length > 0;

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-4 pt-[max(28px,env(safe-area-inset-top))] pb-[max(32px,env(safe-area-inset-bottom))] md:px-6">
        <header className="grid gap-4">
          <Link
            href="/"
            className="flex w-fit items-center gap-2.5 rounded-xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring/40"
          >
            <span className="grid size-10 place-items-center rounded-xl border border-primary/12 bg-muted [&>img]:size-7!">
              <BrandMark decorative />
            </span>
            <span className="font-heading text-lg font-extrabold">
              Billetera Ferial
            </span>
          </Link>
          <div>
            <h1 className="font-heading text-[28px] leading-[34px] font-extrabold">
              {title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Última actualización: <Fill field="lastUpdated" />
            </p>
          </div>
          {draft ? (
            <p
              role="note"
              className="rounded-xl border border-[var(--amber)]/35 bg-[var(--amber-surface)] p-3 text-sm leading-snug text-[var(--amber)]"
            >
              Borrador: este texto todavía no está completo ni revisado. Los
              datos entre corchetes faltan.
            </p>
          ) : null}
          <div className="text-base leading-relaxed">{intro}</div>
        </header>

        <article className="mt-8 grid gap-8">{children}</article>

        <footer className="mt-10 border-t border-border pt-5">
          <nav
            aria-label="Páginas legales"
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm"
          >
            <Link href={TERMS_PATH} className={linkClassName}>
              Términos y condiciones
            </Link>
            <Link href={PRIVACY_PATH} className={linkClassName}>
              Política de privacidad
            </Link>
            <Link href="/" className={linkClassName}>
              Ir a Billetera Ferial
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}

/** A numbered part of a legal page. */
export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="text-lg leading-snug font-bold">
        {title}
      </h2>
      <div className="grid gap-3 text-[15px] leading-relaxed text-foreground/85 [&_li]:pl-1 [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/**
 * A fact from lib/legal/operator.ts. Highlighted while it is still a
 * placeholder, so a draft cannot pass for the final text.
 */
export function Fill({ field }: { field: LegalOperatorField }) {
  const value = legalOperator[field];
  if (!isLegalPlaceholder(value)) return <>{value}</>;
  return (
    <mark className="rounded bg-[var(--amber-surface)] px-1 font-semibold text-[var(--amber)]">
      {value}
    </mark>
  );
}

/** A link in the body of a legal page. */
export function LegalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const external = /^https?:/.test(href);
  return external ? (
    <a href={href} className={linkClassName} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link href={href} className={linkClassName}>
      {children}
    </Link>
  );
}
