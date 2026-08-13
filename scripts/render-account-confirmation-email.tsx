import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pretty, render } from "react-email";
import { AccountConfirmationEmail } from "@/emails/account-confirmation";

const outputPath = resolve(
  process.cwd(),
  ".react-email/out/account-confirmation.html"
);

async function main() {
  const html = await pretty(
    await render(
      <AccountConfirmationEmail
        confirmationUrl="{{ .ConfirmationURL }}"
        siteUrl="{{ .SiteURL }}"
      />
    )
  );

  if (!html.includes("{{ .ConfirmationURL }}")) {
    throw new Error("Exported email is missing {{ .ConfirmationURL }}.");
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
