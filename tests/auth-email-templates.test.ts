import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderSupabaseAuthEmails } from "@/emails/_components/supabase-templates";

// supabase/templates holds the exported HTML that the local stack loads and
// that hosted projects get pasted in. Run `pnpm email:export` after changing
// anything under emails/.
test("committed Supabase email templates match emails/", async () => {
  const config = readFileSync("supabase/config.toml", "utf8");

  for (const email of await renderSupabaseAuthEmails()) {
    const path = `supabase/templates/${email.fileName}`;
    assert.equal(
      readFileSync(path, "utf8"),
      email.html,
      `${path} is out of date: run pnpm email:export`
    );
    assert.ok(
      config.includes(`content_path = "./${path}"`),
      `config.toml does not load ${path}`
    );
    assert.ok(
      config.includes(`subject = "${email.subject}"`),
      `config.toml does not use the subject of ${email.template}`
    );
  }
});
