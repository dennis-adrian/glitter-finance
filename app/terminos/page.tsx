import type { Metadata } from "next";
import {
  Fill,
  LegalLink,
  LegalPage,
  LegalSection,
} from "@/components/templates/legal-page";
import { PRIVACY_PATH } from "@/lib/legal/paths";

// DRAFT, NEEDS A LAWYER'S REVIEW. Describes the service as the code works at
// the time of writing (offline sales and sync, teams by invitation link,
// public product photos, no payment processing, no fiscal invoices). The
// operator's identity, pricing, governing law and courts, and how to delete
// an account are placeholders in lib/legal/operator.ts. A lawyer should look
// in particular at sections 9 (limitation of liability), 10 (termination)
// and 12 (governing law), which are generic wording, not legal advice.

export const metadata: Metadata = {
  title: "Términos y condiciones · Billetera Ferial",
  description:
    "Las condiciones para usar Billetera Ferial, el punto de venta para ferias y convenciones.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Términos y condiciones"
      intro={
        <p>
          Estos términos regulan el uso de Billetera Ferial. Al crear tu cuenta
          o usar el servicio, aceptás estos términos y la{" "}
          <LegalLink href={PRIVACY_PATH}>Política de privacidad</LegalLink>. Si
          no estás de acuerdo, no uses el servicio.
        </p>
      }
    >
      <LegalSection id="servicio" title="1. El servicio">
        <p>
          Billetera Ferial es un punto de venta para vendedores de ferias y
          convenciones. Te permite registrar ventas, armar tu catálogo de
          productos, llevar el stock, ver reportes y trabajar en equipo, desde
          el navegador o instalada como aplicación, con o sin conexión a
          internet.
        </p>
        <p>
          Lo ofrece <Fill field="legalName" />, con domicilio en{" "}
          <Fill field="postalAddress" /> (en estos términos, “nosotros”).
        </p>
      </LegalSection>

      <LegalSection id="cuenta" title="2. Tu cuenta">
        <ul>
          <li>
            Podés crear tu cuenta con tu correo y una contraseña, o entrar con
            Google. Los datos que nos des tienen que ser verdaderos.
          </li>
          <li>
            Cuidá tu contraseña y el acceso a tus dispositivos: lo que se haga
            con tu cuenta corre por tu cuenta y responsabilidad.
          </li>
          <li>
            Edad mínima para usar el servicio: <Fill field="minimumAge" />.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="puestos" title="3. Puestos y equipo">
        <ul>
          <li>
            Tus ventas, productos y stock se organizan en puestos. Quien crea un
            puesto es su propietario.
          </li>
          <li>
            Podés invitar a otras personas a tu puesto con un enlace. Cualquier
            persona que tenga el enlace puede unirse mientras no venza ni lo
            revoques, así que compartilo solo con quien quieras sumar.
          </li>
          <li>
            Los miembros de un puesto pueden ver su catálogo, sus ventas y sus
            reportes, y registrar ventas. Sos responsable de a quién sumás a tu
            puesto y de lo que registra tu equipo.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="uso" title="4. Uso aceptable">
        <p>Al usar Billetera Ferial te comprometés a no:</p>
        <ul>
          <li>
            usarlo para actividades ilegales o para vender productos prohibidos;
          </li>
          <li>
            subir contenido que no te pertenece o que infringe derechos de otras
            personas;
          </li>
          <li>
            cargar datos personales de otras personas sin su permiso, por
            ejemplo en los nombres de productos, los motivos o las fotos;
          </li>
          <li>
            intentar acceder a puestos o datos ajenos, alterar el servicio o
            sobrecargarlo.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="contenido" title="5. Tus datos y tu contenido">
        <p>
          Los datos que cargás (productos, fotos, ventas y stock) son tuyos o de
          tu puesto. Nos das permiso para guardarlos, copiarlos a los
          dispositivos de tu equipo y procesarlos solo para darte el servicio,
          como explica la{" "}
          <LegalLink href={PRIVACY_PATH}>Política de privacidad</LegalLink>.
        </p>
        <p>
          Las fotos de productos son públicas para quien tenga su dirección,
          aunque no sea miembro de tu puesto. No subas fotos con información
          privada.
        </p>
      </LegalSection>

      <LegalSection
        id="sin-conexion"
        title="6. Uso sin conexión y sincronización"
      >
        <ul>
          <li>
            Sin conexión, lo que registrás queda guardado solo en ese
            dispositivo hasta que se sincroniza. Si el dispositivo se pierde, se
            rompe o se borran los datos del navegador antes de eso, esos datos
            se pueden perder.
          </li>
          <li>
            Cerrar sesión borra los datos del puesto guardados en el
            dispositivo. Conectate y sincronizá antes de hacerlo.
          </li>
          <li>
            La fecha y hora de cada venta la toma tu dispositivo: mantené su
            reloj en hora. Si va adelantado, la app retiene sus ventas hasta que
            la hora real las alcance.
          </li>
          <li>
            Cuando dos dispositivos cambian lo mismo sin conexión, al
            sincronizar puede prevalecer uno de los cambios. Revisá tus datos
            después de vender sin conexión en varios dispositivos.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="pagos" title="7. Pagos, precios e impuestos">
        <p>
          Billetera Ferial anota cómo te pagaron (efectivo o QR), pero no
          procesa pagos ni toca tu dinero: los pagos por QR ocurren en la app de
          tu banco. Tampoco emite facturas ni reemplaza tu contabilidad: el
          cumplimiento de tus obligaciones tributarias y comerciales es tuyo.
        </p>
        <p>
          Costo del servicio: <Fill field="pricing" />.
        </p>
      </LegalSection>

      <LegalSection id="disponibilidad" title="8. Disponibilidad y cambios">
        <p>
          Trabajamos para que el servicio funcione siempre, pero puede tener
          interrupciones, errores o cambios, y depende de proveedores externos y
          de tu conexión. Podemos agregar, cambiar o quitar funciones. Si un
          cambio afecta de forma importante cómo usás el servicio, te avisaremos
          con anticipación razonable.
        </p>
      </LegalSection>

      <LegalSection id="responsabilidad" title="9. Responsabilidad">
        <p>
          El servicio se ofrece “tal como está”. En la medida que la ley lo
          permita, no respondemos por ventas perdidas, lucro cesante, pérdida de
          datos no sincronizados ni daños indirectos derivados del uso del
          servicio o de su interrupción. Nada en estos términos limita los
          derechos que la ley te reconoce y que no se pueden renunciar.
        </p>
      </LegalSection>

      <LegalSection id="baja" title="10. Baja del servicio">
        <p>
          Podés dejar de usar Billetera Ferial cuando quieras. Para eliminar tu
          cuenta y tus datos: <Fill field="deletionRequest" />.
        </p>
        <p>
          Podemos suspender o cerrar una cuenta que incumpla estos términos o
          ponga en riesgo el servicio o a otros usuarios. Salvo que sea urgente
          o la ley lo impida, te avisaremos antes.
        </p>
      </LegalSection>

      <LegalSection id="cambios" title="11. Cambios a estos términos">
        <p>
          Si cambiamos estos términos, publicaremos la nueva versión en esta
          página con su fecha y, si el cambio es importante, te avisaremos en la
          app o por correo antes de que entre en vigor. Si seguís usando el
          servicio después, aceptás los términos nuevos.
        </p>
      </LegalSection>

      <LegalSection id="ley" title="12. Ley aplicable">
        <p>
          Estos términos se rigen por <Fill field="governingLaw" />. Cualquier
          controversia se resolverá ante <Fill field="jurisdiction" />.
        </p>
      </LegalSection>

      <LegalSection id="contacto" title="13. Contacto">
        <p>
          Para consultas sobre estos términos, escribinos a{" "}
          <Fill field="contactEmail" /> o a <Fill field="postalAddress" />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
