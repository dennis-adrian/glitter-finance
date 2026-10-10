import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

// `import "server-only"` makes a client import fail with a clear build error,
// but it also throws under plain tsx, where the pnpm db:* and email scripts
// run. So a module that queries the database carries the marker unless one of
// those scripts loads it.

const root = process.cwd();
const sourceExtensions = [".ts", ".tsx", ".mjs", ".js"];

// Runtime imports only: `import type` and `export type` are erased.
const staticImport =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?["']([^"']+)["']/g;
const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function read(file: string) {
  return readFileSync(file, "utf8");
}

function runtimeImports(file: string): string[] {
  const source = read(file);
  const specifiers = [...source.matchAll(staticImport)]
    .filter((match) => !match[1])
    .map((match) => match[2]);
  for (const match of source.matchAll(dynamicImport)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveLocal(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(root, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(from), specifier);
  } else {
    return undefined;
  }
  const candidates = [
    base,
    ...sourceExtensions.map((extension) => base + extension),
    ...sourceExtensions.map((extension) => join(base, "index" + extension)),
  ];
  return candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile()
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(tsx?|mjs)$/.test(name) && !name.endsWith(".d.ts"))
    .map((name) => join(root, dir, name));
}

function isServerOnly(file: string) {
  return runtimeImports(file).includes("server-only");
}

function isServerActionModule(file: string) {
  return /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(
    read(file)
  );
}

// Every local module a script loads, mapped to the chain that reaches it.
function modulesLoadedByScripts(): Map<string, string[]> {
  const reached = new Map<string, string[]>();
  const queue: [string, string[]][] = sourceFiles("scripts").map((file) => [
    file,
    [relative(root, file)],
  ]);
  while (queue.length > 0) {
    const [file, chain] = queue.shift()!;
    if (reached.has(file)) {
      continue;
    }
    reached.set(file, chain);
    for (const specifier of runtimeImports(file)) {
      const target = resolveLocal(file, specifier);
      if (target && !reached.has(target)) {
        queue.push([target, [...chain, relative(root, target)]]);
      }
    }
  }
  return reached;
}

test("no module a pnpm script loads imports server-only", () => {
  const offenders = [...modulesLoadedByScripts()]
    .filter(([file]) => isServerOnly(file))
    .map(([, chain]) => chain.join(" -> "));

  assert.deepEqual(offenders, []);
});

test("every app module that queries the database is server-only", () => {
  const loadedByScripts = modulesLoadedByScripts();
  const unmarked = ["app", "components", "lib"]
    .flatMap(sourceFiles)
    .filter((file) => runtimeImports(file).includes("@/lib/db"))
    .filter((file) => !isServerOnly(file) && !isServerActionModule(file))
    .filter((file) => !loadedByScripts.has(file))
    .map((file) => relative(root, file));

  assert.deepEqual(unmarked, []);
});

test("the scan sees the database modules the scripts share", () => {
  // Guards the import parser: if it stopped resolving these, both tests above
  // would pass without checking anything.
  const loaded = [...modulesLoadedByScripts().keys()].map((file) =>
    relative(root, file)
  );
  for (const file of [
    "lib/db/index.ts",
    "lib/auth/memberships.ts",
    "lib/products/repository.ts",
    "lib/sales/repository.ts",
  ]) {
    assert.ok(loaded.includes(file), `${file} is not reached from scripts/`);
  }
  assert.ok(isServerOnly(join(root, "lib/auth/tenant-members.ts")));
  assert.ok(isServerActionModule(join(root, "app/tenants/actions.ts")));
});
