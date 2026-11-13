// Where Ajustes › Soporte sends a user who needs help. Both channels are
// optional and configured per environment; each one is hidden while its
// variable is unset or invalid.
//
// NEXT_PUBLIC_SUPPORT_EMAIL: an email address, opened with mailto:.
// NEXT_PUBLIC_SUPPORT_WHATSAPP: a phone number in international format, with
// the country code (591 for Bolivia), e.g. "+591 70000000". Spaces, dashes,
// dots and parentheses are ignored.

export type SupportContact = {
  email: { address: string; href: string } | null;
  whatsapp: { display: string; href: string } | null;
};

type SupportEnv = {
  NEXT_PUBLIC_SUPPORT_EMAIL?: string;
  NEXT_PUBLIC_SUPPORT_WHATSAPP?: string;
};

const SUPPORT_SUBJECT = "Ayuda con Billetera Ferial";
const SUPPORT_GREETING = "Hola, necesito ayuda con Billetera Ferial.";

// Deliberately loose: one "@", no spaces, a dot in the domain. Anything
// stricter belongs to the mail client.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmail(value: string | undefined): SupportContact["email"] {
  const address = value?.trim() ?? "";
  if (!EMAIL_PATTERN.test(address)) return null;
  const subject = encodeURIComponent(SUPPORT_SUBJECT);
  return { address, href: `mailto:${address}?subject=${subject}` };
}

function parseWhatsApp(value: string | undefined): SupportContact["whatsapp"] {
  const raw = value?.trim() ?? "";
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  // E.164 allows up to 15 digits; fewer than 8 cannot include a country code.
  if (digits.length < 8 || digits.length > 15) return null;
  const text = encodeURIComponent(SUPPORT_GREETING);
  return {
    display: `+${digits}`,
    href: `https://wa.me/${digits}?text=${text}`,
  };
}

export function parseSupportContact(env: SupportEnv): SupportContact {
  return {
    email: parseEmail(env.NEXT_PUBLIC_SUPPORT_EMAIL),
    whatsapp: parseWhatsApp(env.NEXT_PUBLIC_SUPPORT_WHATSAPP),
  };
}

/**
 * The configured support channels. The `process.env.NEXT_PUBLIC_*` lookups
 * use literal names so Next.js inlines them into the browser bundle.
 */
export function getSupportContact(): SupportContact {
  return parseSupportContact({
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    NEXT_PUBLIC_SUPPORT_WHATSAPP: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP,
  });
}
