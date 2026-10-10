import Module from "node:module";

/**
 * Makes every later `require(specifier)` in this test process return
 * `exports`. The tests run as CommonJS under tsx, and so do the modules they
 * import, so a require.cache entry replaces a module that cannot load outside
 * Next.js: `server-only` throws there, and `next/headers` needs a request.
 * Import the module under test afterwards, with `await import(...)`.
 */
export function stubModule(specifier: string, exports: object) {
  const path = require.resolve(specifier);
  const stub = new Module(path);
  stub.filename = path;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[path] = stub;
}

/** Runs `run` with these variables set and every name in `clear` unset. */
export async function withEnv<T>(
  clear: readonly string[],
  values: Record<string, string>,
  run: () => Promise<T>
): Promise<T> {
  const names = [...new Set([...clear, ...Object.keys(values)])];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    delete process.env[name];
  }
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}
