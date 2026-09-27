import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** The card the sign-in and password screens render in. */
export function AuthPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-[#f2f2f2] text-[#1a2e2c] sm:place-items-center sm:p-4">
      <section className="flex min-h-dvh w-full max-w-[402px] flex-col overflow-hidden bg-[#fffdf8] shadow-[0_16px_32px_rgba(45,27,20,0.06)] sm:h-[min(874px,calc(100dvh-32px))] sm:min-h-0 sm:rounded-[32px]">
        {children}
      </section>
    </main>
  );
}

export function AuthPageHeader({
  title,
  backHref,
}: {
  title: string;
  backHref?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-center gap-3 pt-[max(28px,env(safe-area-inset-top))] pb-6",
        backHref ? "px-4" : "px-6"
      )}
    >
      {backHref ? (
        <Link
          href={backHref}
          aria-label="Volver"
          className="grid h-8 w-9 shrink-0 place-items-center rounded-full bg-[#f4efe6] text-[#1e2d2b] transition-colors hover:bg-[#e9e1d5] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#00786f]/40"
        >
          <ChevronLeft
            aria-hidden="true"
            className="size-4"
            strokeWidth={2.5}
          />
        </Link>
      ) : null}
      <h1 className="font-heading text-[28px] leading-[34px] font-extrabold text-[#1e2d2b]">
        {title}
      </h1>
    </header>
  );
}
