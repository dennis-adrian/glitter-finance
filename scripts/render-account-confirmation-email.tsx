import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pretty, render } from "react-email";
import { AccountConfirmationEmail } from "@/emails/account-confirmation";
import { buildEmailLinkTemplate } from "@/lib/auth/email-link";

const outputPath = resolve(
  process.cwd(),
  ".react-email/out/account-confirmation.html"
);

async function main() {
  // A token-hash link to /auth/confirm, not {{ .ConfirmationURL }}: see
  // lib/auth/email-link.ts.
  const confirmationUrl = buildEmailLinkTemplate("email");
  const html = await pretty(
    await render(
      <AccountConfirmationEmail
        confirmationUrl={confirmationUrl}
        siteUrl="{{ .SiteURL }}"
      />
    )
  );

  // The href is HTML-escaped (& becomes &amp;); browsers decode it back.
  if (!html.includes(confirmationUrl.replaceAll("&", "&amp;"))) {
    throw new Error(`Exported email is missing the link ${confirmationUrl}.`);
  }

  if (!html.includes("{{ .SiteURL }}")) {
    throw new Error("Exported email is missing {{ .SiteURL }}.");
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  console.log(`Confirmation email exported to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
