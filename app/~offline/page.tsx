import {
  StatusScreen,
  statusScreenActionClassName,
} from "@/components/templates/status-screen";

// The service worker precaches this page and shows it for a navigation it
// cannot answer offline (app/sw.ts): before the app was ever opened signed
// in, the login screen, or after logout cleared the saved app. Once the
// signed-in app has loaded its local data online, which saves the app shell
// (lib/pwa/keep-app-shell.ts), an offline launch opens Sell Mode instead.
export default function OfflinePage() {
  return (
    <StatusScreen
      title="Sin conexión"
      description="Esta pantalla aún no está guardada en este dispositivo. Abrí Billetera Ferial una vez con internet para poder vender sin conexión."
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
