import Link from "next/link";
import {
  StatusScreen,
  statusScreenActionClassName,
} from "@/components/templates/status-screen";

export default function NotFound() {
  return (
    <StatusScreen
      title="No encontramos esta página"
      description="El enlace puede estar mal escrito o la página ya no existe."
    >
      <Link href="/" className={statusScreenActionClassName}>
        Ir a Billetera Ferial
      </Link>
    </StatusScreen>
  );
}
