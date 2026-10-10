import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHELL_THEME_COLORS } from "@/lib/shell-theme-colors";

const root = process.cwd();

function read(file: string) {
  return readFileSync(path.join(root, file), "utf8");
}

/** The custom properties declared in the first `selector { … }` block. */
function cssVariables(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} block not found`);
  const block = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim().toLowerCase(),
    ])
  );
}

test("the status bar colors match each theme's page background", () => {
  const css = read("app/globals.css");
  for (const [selector, color] of [
    [":root", SHELL_THEME_COLORS.light],
    [".dark", SHELL_THEME_COLORS.dark],
  ] as const) {
    const variables = cssVariables(css, selector);
    assert.equal(variables.get("--bg"), color, `${selector} --bg`);
    assert.equal(
      variables.get("--background"),
      color,
      `${selector} --background`
    );
  }
});

// The sign-in and password screens and the global error page render outside
// the app shell but follow the theme like every other screen.
const themedFiles = [
  "app/auth/update-password/page.tsx",
  "app/global-error.tsx",
  "app/login/page.tsx",
  "components/molecules/auth-form-fields.tsx",
  "components/molecules/auth-form.tsx",
  "components/molecules/google-sign-in-button.tsx",
  "components/molecules/password-reset-request-form.tsx",
  "components/molecules/update-password-form.tsx",
  "components/templates/auth-page-shell.tsx",
];

// Hex colors that stay: Google's own mark, and the light colors of the
// approved sign-in design that no token matches (DESIGN.md, "Sign-in
// screens"), each next to a dark-mode token.
const allowedHexColors: Record<string, string[]> = {
  "components/molecules/auth-form-fields.tsx": [
    "#8a3329",
    "#005f58",
    "#b4c2bf",
  ],
  "components/molecules/google-sign-in-button.tsx": [
    "#4285f4",
    "#34a853",
    "#fbbc05",
    "#ea4335",
  ],
};

test("the sign-in screens and the global error page use theme colors", () => {
  for (const file of themedFiles) {
    const source = read(file);
    const hexColors = [...source.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) =>
      match[0].toLowerCase()
    );
    assert.deepEqual(
      [...new Set(hexColors)].sort(),
      [...(allowedHexColors[file] ?? [])].sort(),
      file
    );
    assert.doesNotMatch(
      source,
      /\b(?:bg|text|border|outline|ring|fill|stroke)-(?:white|black)\b/,
      file
    );

    for (const line of source.split("\n")) {
      if (/-\[#[0-9a-f]+\]/i.test(line)) {
        assert.match(line, /\bdark:/, `${file}: ${line.trim()}`);
      }
    }
  }
});
