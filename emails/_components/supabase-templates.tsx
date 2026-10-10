import { pretty, render } from "react-email";
import { buildEmailLinkTemplate } from "@/lib/auth/email-link";
import { AccountConfirmationEmail } from "../account-confirmation";
import { PasswordRecoveryEmail } from "../password-recovery";

// The auth emails as Supabase templates: HTML with Supabase's Go template
// variables left in place for Supabase to fill.

const SITE_URL = "{{ .SiteURL }}";

export type SupabaseAuthEmail = {
  /** Supabase's name for the template (Authentication → Email Templates). */
  template: "Confirm signup" | "Reset Password";
  fileName: string;
  subject: string;
  html: string;
};

async function renderTemplate(
  element: React.ReactElement,
  link: string
): Promise<string> {
  const html = await pretty(await render(element));
  // The href is HTML-escaped (& becomes &amp;); browsers decode it back.
  if (!html.includes(link.replaceAll("&", "&amp;"))) {
    throw new Error(`Exported email is missing the link ${link}.`);
  }
  if (!html.includes(`${SITE_URL}/icons/`)) {
    throw new Error(`Exported email is missing ${SITE_URL}.`);
  }
  return html;
}

export async function renderSupabaseAuthEmails(): Promise<SupabaseAuthEmail[]> {
  // Token-hash links to /auth/confirm, not {{ .ConfirmationURL }}: see
  // lib/auth/email-link.ts.
  const confirmationUrl = buildEmailLinkTemplate("email");
  const recoveryUrl = buildEmailLinkTemplate("recovery");

  return [
    {
      template: "Confirm signup",
      fileName: "account-confirmation.html",
      subject: "Confirmá tu correo | Billetera Ferial",
      html: await renderTemplate(
        <AccountConfirmationEmail
          confirmationUrl={confirmationUrl}
          siteUrl={SITE_URL}
        />,
        confirmationUrl
      ),
    },
    {
      template: "Reset Password",
      fileName: "password-recovery.html",
      subject: "Creá una contraseña nueva | Billetera Ferial",
      html: await renderTemplate(
        <PasswordRecoveryEmail recoveryUrl={recoveryUrl} siteUrl={SITE_URL} />,
        recoveryUrl
      ),
    },
  ];
}
