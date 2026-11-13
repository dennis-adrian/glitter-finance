import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPage from "@/app/privacidad/page";
import TermsPage from "@/app/terminos/page";
import {
  isLegalPlaceholder,
  legalOperator,
  legalPlaceholdersLeft,
} from "@/lib/legal/operator";
import {
  isLegalPagePath,
  LEGAL_PAGE_PATHS,
  PRIVACY_PATH,
  TERMS_PATH,
} from "@/lib/legal/paths";

test("recognizes the legal pages, with or without a trailing slash", () => {
  assert.deepEqual(LEGAL_PAGE_PATHS, ["/terminos", "/privacidad"]);
  for (const pathname of ["/terminos", "/terminos/", "/privacidad"]) {
    assert.equal(isLegalPagePath(pathname), true, pathname);
  }
  for (const pathname of ["/", "/login", "/terminosx", "/privacidad/a"]) {
    assert.equal(isLegalPagePath(pathname), false, pathname);
  }
});

test("lists the operator facts still left as placeholders", () => {
  assert.equal(isLegalPlaceholder("[NOMBRE]"), true);
  assert.equal(isLegalPlaceholder("Ana Pérez"), false);
  assert.deepEqual(
    legalPlaceholdersLeft({ legalName: "Ana Pérez", governingLaw: "[LEY]" }),
    ["governingLaw"]
  );
});

// Both pages are server components with no request data, so they render
// without a session, cookies or the database.
const pages = [
  { path: TERMS_PATH, Page: TermsPage, title: "Términos y condiciones" },
  { path: PRIVACY_PATH, Page: PrivacyPage, title: "Política de privacidad" },
];

for (const { path, Page, title } of pages) {
  test(`${path} renders signed out and links to the other legal page`, () => {
    const html = renderToStaticMarkup(Page());
    assert.match(html, new RegExp(`<h1[^>]*>${title}</h1>`));
    assert.match(html, /href="\/terminos"/);
    assert.match(html, /href="\/privacidad"/);
  });

  test(`${path} shows the draft notice while a placeholder is left`, () => {
    const html = renderToStaticMarkup(Page());
    const draft = legalPlaceholdersLeft().length > 0;
    assert.equal(html.includes("Borrador:"), draft);
    if (draft) assert.match(html, /<mark/);
  });
}

test("the privacy policy names every provider the app sends data to", () => {
  const html = renderToStaticMarkup(PrivacyPage());
  for (const provider of [
    "Supabase",
    "PowerSync",
    "Vercel",
    "Resend",
    "Sentry",
    "Google",
  ]) {
    assert.match(html, new RegExp(`<strong>${provider}</strong>`), provider);
  }
});

test("every placeholder field is used by at least one legal page", () => {
  const html =
    renderToStaticMarkup(TermsPage()) + renderToStaticMarkup(PrivacyPage());
  const unused = Object.entries(legalOperator)
    .filter(([, value]) => !html.includes(value))
    .map(([field]) => field);
  assert.deepEqual(unused, []);
});
