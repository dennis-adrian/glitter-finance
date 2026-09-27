import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderSupabaseAuthEmails } from "@/emails/_components/supabase-templates";

const outputDir = resolve(process.cwd(), ".react-email/out");

async function main() {
  await mkdir(outputDir, { recursive: true });

  for (const email of await renderSupabaseAuthEmails()) {
    const outputPath = resolve(outputDir, email.fileName);
    await writeFile(outputPath, email.html, "utf8");
    console.log(
      `${email.template} email exported to ${outputPath} (subject: ${email.subject})`
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
