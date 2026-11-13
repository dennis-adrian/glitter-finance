import { FileText, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { SettingsLinkItem } from "@/components/molecules/settings-link-item";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/paths";
import { getSupportContact } from "@/lib/support-contact";

/**
 * Ajustes › Soporte's ways to reach a person, from NEXT_PUBLIC_SUPPORT_EMAIL
 * and NEXT_PUBLIC_SUPPORT_WHATSAPP (lib/support-contact.ts). Renders nothing
 * for a channel that is not configured.
 */
export function SupportContactItems() {
  const { email, whatsapp } = getSupportContact();
  return (
    <>
      {whatsapp ? (
        <SettingsLinkItem
          icon={<MessageCircle size={21} />}
          label="Escribinos por WhatsApp"
          value={whatsapp.display}
          href={whatsapp.href}
        />
      ) : null}
      {email ? (
        <SettingsLinkItem
          icon={<Mail size={21} />}
          label="Escribinos por correo"
          value={email.address}
          href={email.href}
        />
      ) : null}
    </>
  );
}

/** Ajustes › Legal: the public terms and privacy pages. */
export function LegalSettingsItems() {
  return (
    <>
      <SettingsLinkItem
        icon={<FileText size={21} />}
        label="Términos y condiciones"
        value="Las condiciones para usar Billetera Ferial"
        href={TERMS_PATH}
      />
      <SettingsLinkItem
        icon={<ShieldCheck size={21} />}
        label="Política de privacidad"
        value="Qué datos guardamos y cómo los cuidamos"
        href={PRIVACY_PATH}
      />
    </>
  );
}
