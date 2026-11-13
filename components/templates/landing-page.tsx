import Link from "next/link";
import {
  Banknote,
  Boxes,
  ChartColumn,
  CircleCheck,
  EllipsisVertical,
  Hand,
  Images,
  Receipt,
  RefreshCw,
  Share,
  ShoppingBag,
  Smartphone,
  Store,
  Users,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { LANDING_PATH } from "@/lib/public-site";
import { VOID_WINDOW_MINUTES } from "@/lib/sales";
import { cn } from "@/lib/utils";

// Every claim here is something the app does today (README, docs/
// implementation-notes.md). Nothing from the PRD's future features, and no
// pricing.

export const SIGN_UP_HREF = "/login?mode=signup";
export const SIGN_IN_HREF = "/login?mode=signin";

const gutters = "mx-auto w-full max-w-6xl px-4 md:px-6 lg:px-8";

const features: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Hand,
    title: "Vendé con un toque",
    description:
      "Tocá un producto para sumarlo al pedido. Aplicá descuentos a un producto o a toda la venta.",
  },
  {
    icon: Banknote,
    title: "Efectivo o QR",
    description:
      "Marcá cuánto te pagaron y la app calcula el cambio. Con QR, te recuerda confirmar que la transferencia llegó antes de registrar la venta.",
  },
  {
    icon: Images,
    title: "Tu catálogo, con fotos",
    description:
      "Precio, categoría, foto y, si querés, el costo de cada producto. Archivá lo que ya no vendés.",
  },
  {
    icon: Receipt,
    title: "Cada venta, registrada",
    description: `Revisá el historial, compartí el recibo, anulá una venta en los primeros ${VOID_WINDOW_MINUTES} minutos o registrá una devolución.`,
  },
  {
    icon: ChartColumn,
    title: "Reportes claros",
    description:
      "Hoy, esta semana, este mes o las fechas que elijas: ventas, descuentos, costo y ganancia neta, por categoría, producto, método de pago y vendedor.",
  },
  {
    icon: Boxes,
    title: "Stock, si lo necesitás",
    description:
      "Activalo en los productos que quieras: contá lo que llevás, sumá reposiciones y anotá pérdidas o regalos. Te avisa cuando queda poco.",
  },
  {
    icon: Users,
    title: "Vendé en equipo",
    description:
      "Invitá con un enlace a quien te ayuda en el puesto. Cada persona vende desde su teléfono y los reportes muestran quién vendió qué.",
  },
  {
    icon: Store,
    title: "Más de un puesto",
    description:
      "¿Tenés más de un emprendimiento? Creá varios puestos y pasá de uno a otro sin cerrar sesión.",
  },
];

const offlinePoints: {
  icon: LucideIcon;
  title: string;
  description: string;
}[] = [
  {
    icon: WifiOff,
    title: "Vendé sin señal",
    description:
      "Tu catálogo, las fotos de tus productos y el pedido siguen en el teléfono aunque no haya internet.",
  },
  {
    icon: RefreshCw,
    title: "Se sincroniza sola",
    description:
      "Las ventas que hiciste sin conexión se suben cuando vuelve la señal, y aparecen en los teléfonos de tu equipo.",
  },
  {
    icon: CircleCheck,
    title: "Siempre sabés cómo va",
    description:
      "Un indicador en pantalla te muestra si estás sin conexión o si todo ya está sincronizado.",
  },
];

const installGuides: {
  device: string;
  browser: string;
  steps: React.ReactNode[];
}[] = [
  {
    device: "iPhone",
    browser: "Safari",
    steps: [
      "Abrí esta página en Safari.",
      <>
        Tocá <strong className="font-semibold">Compartir</strong>{" "}
        <Share aria-hidden="true" className="inline size-4 align-[-2px]" />.
      </>,
      <>
        Elegí{" "}
        <strong className="font-semibold">Agregar a pantalla de inicio</strong>{" "}
        y confirmá.
      </>,
    ],
  },
  {
    device: "Android",
    browser: "Chrome",
    steps: [
      "Abrí esta página en Chrome.",
      <>
        Tocá el menú{" "}
        <EllipsisVertical
          aria-label="de tres puntos"
          className="inline size-4 align-[-2px]"
        />{" "}
        arriba a la derecha.
      </>,
      <>
        Elegí <strong className="font-semibold">Instalar app</strong> o{" "}
        <strong className="font-semibold">
          Agregar a la pantalla principal
        </strong>
        .
      </>,
    ],
  },
];

const ctaClassName = "w-full rounded-2xl! sm:w-auto sm:min-w-44";

function CallsToAction({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row", className)}>
      <Link
        href={SIGN_UP_HREF}
        className={cn(buttonVariants({ size: "lg" }), ctaClassName)}
      >
        Crear cuenta
      </Link>
      <Link
        href={SIGN_IN_HREF}
        className={cn(
          buttonVariants({ size: "lg", variant: "outline" }),
          ctaClassName
        )}
      >
        Iniciar sesión
      </Link>
    </div>
  );
}

function IconBadge({
  icon: Icon,
  tone = "primary",
  onMuted = false,
}: {
  icon: LucideIcon;
  tone?: "primary" | "accent";
  /** On a `bg-muted` band, where the primary badge's own fill would vanish. */
  onMuted?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid size-12 shrink-0 place-items-center rounded-2xl",
        tone === "accent"
          ? "bg-secondary/10 text-secondary"
          : onMuted
            ? "bg-card text-primary"
            : "bg-muted text-primary"
      )}
    >
      <Icon aria-hidden="true" className="size-6" strokeWidth={1.8} />
    </span>
  );
}

const sampleTiles = [
  {
    name: "Sticker gato",
    price: "15 Bs",
    tone: "aurora",
    initial: "S",
    qty: 2,
  },
  { name: "Print A5", price: "40 Bs", tone: "violet", initial: "P", qty: 0 },
  {
    name: "Pin esmaltado",
    price: "25 Bs",
    tone: "coral",
    initial: "P",
    qty: 1,
  },
  { name: "Llavero", price: "20 Bs", tone: "warm", initial: "L", qty: 0 },
];

/** A picture of Vender, built from the same tokens; not interactive. */
function SellPreview() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-[360px] rounded-4xl bg-card p-4 shadow-[0_16px_32px_rgba(45,27,20,0.08)] ring-1 ring-foreground/10"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-heading text-xl font-extrabold text-primary">
          Vender
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground/70">
          <span className="size-2 rounded-full bg-[var(--green)]" />
          Sincronizado
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {sampleTiles.map((tile) => (
          <div
            key={tile.name}
            className={cn(
              "overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10",
              tile.qty > 0 && "ring-2 ring-primary"
            )}
          >
            <span className={cn("product-art", tile.tone)}>
              <span className="text-[40px]!">{tile.initial}</span>
              {tile.qty > 0 ? (
                <span className="absolute! top-2 right-2 grid h-7 min-w-7 place-items-center rounded-full bg-primary px-2 text-sm! font-bold text-primary-foreground!">
                  {tile.qty}×
                </span>
              ) : null}
            </span>
            <div className="px-3 py-2">
              <p className="truncate text-[15px] text-foreground">
                {tile.name}
              </p>
              <p className="text-lg font-bold text-primary">{tile.price}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="relative grid size-12 place-items-center rounded-full border-[1.5px] border-primary text-primary">
          <ShoppingBag className="size-5" />
          <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground">
            3
          </span>
        </span>
        <span className="flex h-12 flex-1 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
          Cobrar · 55 Bs
        </span>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header
        className={cn(
          gutters,
          "flex items-center justify-between gap-3 pt-[max(16px,env(safe-area-inset-top))] pb-4"
        )}
      >
        <Link
          href={LANDING_PATH}
          className="flex items-center gap-2.5 rounded-xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring/40"
        >
          <BrandMark decorative />
          <span className="font-heading text-xl font-extrabold">
            Billetera Ferial
          </span>
        </Link>
        <Link
          href={SIGN_IN_HREF}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Iniciar sesión
        </Link>
      </header>

      <main>
        <section
          aria-labelledby="hero-title"
          className={cn(
            gutters,
            "grid items-center gap-10 pt-6 pb-14 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pt-12 lg:pb-20"
          )}
        >
          <div className="flex flex-col items-start gap-5">
            <p className="rounded-full bg-secondary/10 px-3 py-1 text-sm font-semibold text-secondary-foreground dark:text-secondary">
              Para ferias, convenciones y mercados
            </p>
            <h1
              id="hero-title"
              className="font-heading text-[34px] leading-[1.1] font-extrabold text-balance md:text-5xl"
            >
              Tu punto de venta para cada feria
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-foreground/70 md:text-lg">
              Cargá tus productos, armá el pedido con un toque y cobrá en
              efectivo o por QR. Billetera Ferial registra cada venta y te
              muestra cuánto ganaste, aunque en la feria no haya señal.
            </p>
            <CallsToAction className="w-full sm:w-auto" />
            <p className="max-w-xl text-sm leading-snug text-foreground/70">
              Entrás con tu correo o con tu cuenta de Google. Funciona en el
              navegador del teléfono: no hace falta bajarla de una tienda de
              apps.
            </p>
          </div>
          <SellPreview />
        </section>

        <section
          id="funciones"
          aria-labelledby="features-title"
          className={cn(gutters, "pb-14 lg:pb-20")}
        >
          <h2
            id="features-title"
            className="font-heading text-[26px] leading-tight font-extrabold md:text-[32px]"
          >
            Todo lo que necesitás en el puesto
          </h2>
          <p className="mt-2 max-w-2xl text-base text-foreground/70">
            Pensada para ilustradores, artesanos y emprendedores que venden en
            varias ferias al año.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon, title, description }) => (
              <li
                key={title}
                className="flex items-start gap-4 rounded-3xl bg-card p-5 ring-1 ring-foreground/10 sm:flex-col sm:gap-3"
              >
                <IconBadge icon={icon} />
                <div>
                  <h3 className="text-base font-bold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-foreground/70 sm:mt-2">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="sin-conexion"
          aria-labelledby="offline-title"
          className="bg-muted py-14 lg:py-20"
        >
          <div className={cn(gutters, "grid gap-10 lg:grid-cols-2 lg:gap-16")}>
            <div>
              <h2
                id="offline-title"
                className="font-heading text-[26px] leading-tight font-extrabold md:text-[32px]"
              >
                Funciona sin conexión
              </h2>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-foreground/70">
                En muchas ferias la señal no alcanza. Billetera Ferial guarda tu
                catálogo y tus ventas en el teléfono, así que podés seguir
                cobrando sin internet.
              </p>
              <p className="mt-5 max-w-xl rounded-2xl border-l-4 border-primary bg-card p-4 text-sm leading-relaxed">
                <strong className="font-bold">
                  Antes de tu primera feria:
                </strong>{" "}
                iniciá sesión y abrí la app una vez con internet, para que quede
                guardada en el teléfono.
              </p>
            </div>
            <ul className="grid gap-6">
              {offlinePoints.map(({ icon, title, description }, index) => (
                <li key={title} className="flex items-start gap-4">
                  <IconBadge
                    icon={icon}
                    tone={index === 0 ? "accent" : "primary"}
                    onMuted
                  />
                  <div>
                    <h3 className="text-base font-bold">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-foreground/70">
                      {description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="instalar"
          aria-labelledby="install-title"
          className={cn(gutters, "py-14 lg:py-20")}
        >
          <div className="flex items-start gap-4">
            <IconBadge icon={Smartphone} />
            <div>
              <h2
                id="install-title"
                className="font-heading text-[26px] leading-tight font-extrabold md:text-[32px]"
              >
                Instalala en tu teléfono
              </h2>
              <p className="mt-2 max-w-2xl text-base leading-relaxed text-foreground/70">
                Desde el navegador la agregás a la pantalla de inicio, y se abre
                a pantalla completa como cualquier otra app.
              </p>
            </div>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {installGuides.map(({ device, browser, steps }) => (
              <section
                key={device}
                aria-label={`${device} con ${browser}`}
                className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10"
              >
                <h3 className="text-base font-bold">
                  {device}{" "}
                  <span className="font-normal text-foreground/70">
                    · {browser}
                  </span>
                </h3>
                <ol className="mt-4 grid gap-3">
                  {steps.map((step, index) => (
                    <li key={index} className="flex items-start gap-3 text-sm">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                        {index + 1}
                      </span>
                      <span className="pt-1 leading-snug">{step}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          <p className="mt-4 text-sm text-foreground/70">
            Después, abrila desde su ícono e iniciá sesión.
          </p>
        </section>

        <section
          aria-labelledby="cta-title"
          className={cn(gutters, "pb-16 lg:pb-24")}
        >
          <div className="flex flex-col items-start gap-4 rounded-4xl bg-primary/10 p-6 md:p-10 dark:bg-primary/15">
            <h2
              id="cta-title"
              className="font-heading text-[26px] leading-tight font-extrabold md:text-[32px]"
            >
              Prepará tu próxima feria
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-foreground/70">
              Creá tu cuenta, cargá tus productos y probá un cobro antes de
              salir.
            </p>
            <CallsToAction className="w-full sm:w-auto" />
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div
          className={cn(
            gutters,
            "flex flex-col gap-3 pt-6 pb-[max(24px,env(safe-area-inset-bottom))] text-sm text-foreground/70 sm:flex-row sm:items-center sm:justify-between"
          )}
        >
          <p className="flex items-center gap-2">
            <BrandMark size="small" decorative />
            Billetera Ferial
          </p>
          <nav aria-label="Cuenta" className="flex gap-5">
            <Link href={SIGN_IN_HREF} className="hover:text-foreground">
              Iniciar sesión
            </Link>
            <Link href={SIGN_UP_HREF} className="hover:text-foreground">
              Crear cuenta
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
