import type { Metadata } from "next";
import {
  Fill,
  LegalLink,
  LegalPage,
  LegalSection,
} from "@/components/templates/legal-page";
import { TERMS_PATH } from "@/lib/legal/paths";

// DRAFT, NEEDS A LAWYER'S REVIEW. Written from what the code does at the
// time of writing (docs/implementation-notes.md, docs/production-
// observability.md, lib/observability/sentry-*.ts, lib/db/schema.ts,
// app/sw.ts, lib/powersync/local-data-teardown.ts). Revisit it whenever a
// change adds a provider, a kind of data or a new use of one. Every fact the
// code cannot give (who the operator is, retention, how to ask for deletion,
// governing law) is a placeholder in lib/legal/operator.ts. Points a lawyer
// should look at in particular: the legal basis for processing, transfers of
// data outside Bolivia to the providers below, and the rights section.

export const metadata: Metadata = {
  title: "Política de privacidad · Billetera Ferial",
  description:
    "Qué datos trata Billetera Ferial, para qué, con quién los comparte y cómo podés pedir que se borren.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Política de privacidad"
      intro={
        <p>
          Billetera Ferial es un punto de venta para vendedores de ferias y
          convenciones. Esta política explica qué datos tratamos cuando lo usás,
          para qué, dónde se guardan, con quién los compartimos y qué podés
          hacer con ellos. Complementa los{" "}
          <LegalLink href={TERMS_PATH}>Términos y condiciones</LegalLink>.
        </p>
      }
    >
      <LegalSection id="responsable" title="1. Quién es responsable">
        <p>
          El responsable de tus datos es <Fill field="legalName" />, con
          domicilio en <Fill field="postalAddress" />. Para cualquier consulta
          sobre esta política o sobre tus datos, escribinos a{" "}
          <Fill field="contactEmail" />.
        </p>
      </LegalSection>

      <LegalSection id="datos" title="2. Qué datos tratamos">
        <p>
          <strong>Tu cuenta.</strong> Tu nombre, tu correo electrónico y tu
          contraseña. La contraseña la guarda nuestro proveedor de autenticación
          de forma que nadie, ni siquiera nosotros, puede leerla. Si entrás con
          Google, Google nos comparte tu nombre, tu correo y, si la tenés, la
          dirección de tu foto de perfil; con Google no creamos contraseña.
        </p>
        <p>
          <strong>Tu puesto y tu equipo.</strong> El nombre de cada puesto, sus
          miembros con el nombre que muestran, quién lo creó y los enlaces de
          invitación, con su fecha de vencimiento.
        </p>
        <p>
          <strong>Tu catálogo.</strong> Productos, precios, categorías, fotos de
          productos, stock y cada movimiento de inventario (reposiciones,
          pérdidas, regalos y ajustes).
        </p>
        <p>
          <strong>Tus ventas.</strong> Los productos vendidos, cantidades,
          precios, descuentos y su motivo, el método de pago (efectivo o QR), la
          fecha y hora, quién registró la venta, y las anulaciones y
          devoluciones con su motivo.
        </p>
        <p>
          Billetera Ferial no pide datos de tus compradores ni procesa pagos:
          solo anota cómo te pagaron. Te pedimos que no escribas datos
          personales de otras personas en los nombres de productos, los motivos
          de descuentos o devoluciones ni en las fotos.
        </p>
        <p>
          <strong>Datos técnicos.</strong> Como cualquier servicio web, nuestros
          proveedores de alojamiento registran datos técnicos de cada solicitud,
          como la dirección IP, el navegador y la hora. Cuando la app falla,
          enviamos un reporte de error (ver la sección 6).
        </p>
      </LegalSection>

      <LegalSection id="usos" title="3. Para qué los usamos">
        <ul>
          <li>
            Para darte el servicio: iniciar sesión, guardar tu catálogo, tus
            ventas y tu stock, y mostrarte tus reportes.
          </li>
          <li>
            Para sincronizar esos datos entre los dispositivos de los miembros
            de tu puesto, también después de vender sin conexión.
          </li>
          <li>
            Para enviarte los correos que el servicio necesita, como la
            confirmación de tu correo y la recuperación de tu contraseña.
          </li>
          <li>Para encontrar y corregir errores de la app.</li>
        </ul>
        <p>
          No usamos herramientas de analítica ni de seguimiento, no mostramos
          publicidad, no vendemos tus datos y no los usamos para armar perfiles
          de vos.
        </p>
      </LegalSection>

      <LegalSection id="proveedores" title="4. Con quién los compartimos">
        <p>
          Solo con los proveedores que hacen funcionar el servicio, que tratan
          los datos por cuenta nuestra:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong>: autenticación (correo y contraseña, y el
            ingreso con Google), la base de datos donde se guardan tu puesto,
            catálogo, stock, ventas y equipo, y el almacenamiento de las fotos
            de productos.
          </li>
          <li>
            <strong>PowerSync</strong>: sincroniza los datos de tu puesto entre
            la base de datos y tus dispositivos.
          </li>
          <li>
            <strong>Vercel</strong>: aloja la aplicación web y su servidor.
          </li>
          <li>
            <strong>Resend</strong>: envía los correos del servicio.
          </li>
          <li>
            <strong>Sentry</strong>: recibe los reportes de errores.
          </li>
          <li>
            <strong>Google</strong>: solo si elegís entrar con Google.
          </li>
        </ul>
        <p>
          Estos proveedores pueden tratar los datos fuera de Bolivia. Fuera de
          ellos, solo compartiríamos datos si una autoridad competente lo exige
          conforme a la ley.
        </p>
        <p>
          Dentro de tu puesto, los demás miembros ven tu nombre, el catálogo y
          las ventas que registrás, y quién registró cada una.
        </p>
      </LegalSection>

      <LegalSection id="fotos" title="5. Fotos de productos">
        <p>
          Las fotos de productos se guardan en un almacenamiento público: no
          aparecen en ningún listado, pero cualquier persona que tenga la
          dirección de una foto puede verla, aunque no sea miembro de tu puesto.
          Por eso, subí solo fotos de tus productos y nunca fotos con personas,
          documentos u otra información privada.
        </p>
      </LegalSection>

      <LegalSection id="errores" title="6. Reportes de errores">
        <p>
          Cuando algo falla, la app envía a Sentry un reporte con el error, el
          lugar del código donde ocurrió, la página, el navegador y el sistema
          del dispositivo. También envía datos de rendimiento de una parte de
          las visitas (alrededor de una de cada diez). Sin conexión, los
          reportes esperan en el dispositivo y se envían al reconectar.
        </p>
        <p>
          Los reportes no incluyen tu nombre, tu correo, tu identificador de
          usuario ni el de tu puesto, cookies, encabezados ni el contenido de lo
          que la app envía o recibe. Antes de enviarlos, la app borra los
          parámetros de las direcciones, los enlaces de invitación y los valores
          de las consultas a la base de datos. Cuando falla una sincronización,
          el reporte solo dice qué tipo de operación falló, nunca los montos ni
          los productos de la venta. No grabamos tu pantalla ni tus sesiones.
        </p>
        <p>
          Sentry conserva los reportes durante{" "}
          <Fill field="errorReportRetention" />.
        </p>
      </LegalSection>

      <LegalSection
        id="dispositivo"
        title="7. Datos guardados en tu dispositivo"
      >
        <p>
          Para que puedas vender sin conexión, la app guarda en tu dispositivo
          una copia de los datos de tu puesto (catálogo, stock, ventas y
          equipo), los cambios que todavía no se sincronizaron, el pedido en
          curso, la aplicación misma y las fotos de productos ya vistas. También
          guarda tu preferencia de tema (claro u oscuro).
        </p>
        <p>
          Usamos solo las cookies necesarias para mantener tu sesión iniciada.
          No usamos cookies de publicidad ni de seguimiento.
        </p>
        <p>
          Al cerrar sesión desde la app, se borran del dispositivo los datos de
          tu puesto, los cambios pendientes y las fotos guardadas; quedan solo
          los archivos de la aplicación. Si el dispositivo se pierde con la
          sesión iniciada, cualquiera que lo use puede ver los datos de tu
          puesto, así que protegelo con un bloqueo de pantalla.
        </p>
      </LegalSection>

      <LegalSection id="conservacion" title="8. Cuánto tiempo los guardamos">
        <p>
          Guardamos los datos de tu cuenta y de tu puesto mientras uses el
          servicio. Después: <Fill field="dataRetention" />.
        </p>
      </LegalSection>

      <LegalSection id="derechos" title="9. Tus derechos">
        <p>
          Podés pedirnos acceso a tus datos, que corrijamos los que estén mal o
          que los eliminemos. Para eso: <Fill field="deletionRequest" />.
        </p>
        <p>
          Muchos datos los podés corregir vos mismo desde la app, como los
          productos, sus fotos y el stock. Tené en cuenta que las ventas forman
          parte del registro de tu puesto y también son datos de los demás
          miembros.
        </p>
      </LegalSection>

      <LegalSection id="seguridad" title="10. Seguridad">
        <p>
          Las conexiones con el servicio van cifradas. La base de datos solo
          deja que cada usuario lea y modifique los datos de los puestos de los
          que es miembro, y los enlaces de invitación vencen y se pueden
          revocar. Ningún sistema es infalible: si notás un acceso que no
          reconocés, escribinos a <Fill field="contactEmail" />.
        </p>
      </LegalSection>

      <LegalSection id="menores" title="11. Menores de edad">
        <p>
          Edad mínima para usar Billetera Ferial: <Fill field="minimumAge" />.
        </p>
      </LegalSection>

      <LegalSection id="cambios" title="12. Cambios a esta política">
        <p>
          Si cambiamos esta política, publicaremos la nueva versión en esta
          página con su fecha. Si el cambio es importante, también te avisaremos
          en la app o por correo antes de que entre en vigor.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
