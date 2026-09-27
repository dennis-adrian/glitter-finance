/**
 * The app compiles with TypeScript 7, but typescript-eslint (pulled in by
 * eslint-config-next) only supports `typescript >=4.8.4 <6.1.0` and crashes
 * on load against TypeScript 7's API. `typescript` is a peer dependency of
 * that toolchain, so it would resolve to the project's TypeScript 7, and pnpm
 * `overrides` cannot redirect a peer to a different version than the one the
 * project provides. Instead, give the lint toolchain its own supported
 * TypeScript as a regular dependency.
 *
 * Remove this hook once typescript-eslint supports TypeScript 7.
 */
const LINT_TYPESCRIPT = "~6.0.3";

function isLintTypeScriptConsumer(name) {
  return (
    name === "eslint-config-next" ||
    name === "typescript-eslint" ||
    name.startsWith("@typescript-eslint/")
  );
}

function readPackage(pkg) {
  if (
    !isLintTypeScriptConsumer(pkg.name) ||
    !pkg.peerDependencies?.typescript
  ) {
    return pkg;
  }

  delete pkg.peerDependencies.typescript;
  delete pkg.peerDependenciesMeta?.typescript;
  pkg.dependencies = { ...pkg.dependencies, typescript: LINT_TYPESCRIPT };
  return pkg;
}

module.exports = { hooks: { readPackage } };
