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
