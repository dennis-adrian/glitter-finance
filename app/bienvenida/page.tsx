import type { Metadata } from "next";
import { InstalledAppRedirect } from "@/components/atoms/installed-app-redirect";
import { LandingPage } from "@/components/templates/landing-page";
import { LANDING_PATH, shareMetadata, SITE_NAME } from "@/lib/public-site";

const title = "Billetera Ferial: tu punto de venta para cada feria";
const description =
  "Cobrá en efectivo o por QR, llevá tu catálogo y mirá tus reportes desde el teléfono, aunque la feria no tenga señal. Para ilustradores, artesanos y emprendedores de ferias y convenciones.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: LANDING_PATH },
  applicationName: SITE_NAME,
  ...shareMetadata({ title, description, path: LANDING_PATH }),
};

// Static: it reads no session, so the proxy skips it (proxy.ts) and a CDN can
// serve it. The service worker's page rule may cache it like any other page;
// it never stands in for the app shell, which is "/" alone.
export default function BienvenidaPage() {
  return (
    <>
      <InstalledAppRedirect to="/login" />
      <LandingPage />
    </>
  );
}
