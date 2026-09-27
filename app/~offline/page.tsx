import {
  StatusScreen,
  statusScreenActionClassName,
} from "@/components/templates/status-screen";

// The service worker precaches this page and shows it for a navigation it
// cannot answer offline (app/sw.ts): the first launch, the login screen, or
// after logout cleared the saved app. Once the app has been opened online,
// an offline launch opens Sell Mode instead.
export default function OfflinePage() {
  return (
    <StatusScreen
      title="Sin conexión"
      description="Esta pantalla aún no está guardada en este dispositivo. Abre Billetera Ferial una vez con internet para poder vender sin conexión."
    >
      {/* A full page load, not a client-side <Link> transition, so the
          service worker answers it again with the network or the saved app. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className={statusScreenActionClassName}>
        Reintentar
      </a>
    </StatusScreen>
  );
}
