// Opens many sync connections against a PowerSync instance and holds them,
// to check that a self-hosted instance (powersync/self-hosted) takes the
// number of devices a festival brings. Every connection is a real sync
// stream: it authenticates, downloads the puesto's data and stays open.
//
//   POWERSYNC_URL=https://sync.example.com \
//   QA_EMAIL=... QA_PASSWORD=... \
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
//   pnpm powersync:load-test -- --connections 300 --ramp 60 --hold 300
//
// All connections sign in as the one QA user, which is enough to count
// connections and memory; it does not exercise 300 different puestos. Run it
// against staging, never against an instance vendors are using. With
// POWERSYNC_TOKEN set, that access token is used and nothing signs in.
// The variables come from the command line only: no .env file is read, so
// the target is always the one typed. A Supabase access token lasts an hour,
// so keep --ramp plus --hold under that.
//
// --transport ws (the default) connects the way the app does, over a
// WebSocket, with the client library's own code. --transport http opens HTTP
// streams. The service counts the two separately, each against
// api.parameters.max_concurrent_connections, so size an instance with ws.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type LoadTestTransport = "ws" | "http";

export type LoadTestOptions = {
  connections: number;
  rampSeconds: number;
  holdSeconds: number;
  transport: LoadTestTransport;
};

const DEFAULTS: LoadTestOptions = {
  connections: 100,
  rampSeconds: 30,
  holdSeconds: 60,
  transport: "ws",
};

export function parseLoadTestArgs(args: string[]): LoadTestOptions {
  const options = { ...DEFAULTS };
  const names: Record<string, "connections" | "rampSeconds" | "holdSeconds"> = {
    "--connections": "connections",
    "--ramp": "rampSeconds",
    "--hold": "holdSeconds",
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--transport") {
      const value = args[i + 1];
      if (value !== "ws" && value !== "http") {
        throw new Error(`--transport is ws or http, got: ${value}`);
      }
      options.transport = value;
      i += 1;
      continue;
    }
    const key = names[arg];
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    const value = Number(args[i + 1]);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${arg} needs a whole number, got: ${args[i + 1]}`);
    }
    options[key] = value;
    i += 1;
  }
  if (options.connections < 1) throw new Error("--connections must be >= 1");
  return options;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

type ConnectionResult = {
  /** ms until the first line of the stream arrived. */
  firstLineMs: number | null;
  /** ms until the first complete checkpoint: the device is in sync. */
  syncedMs: number | null;
  rows: number;
  /** Set when the connection ended before the test closed it. */
  failure: string | null;
};

/** How many times `needle` occurs in `bytes`. */
export function countOccurrences(bytes: Uint8Array, needle: Uint8Array) {
  let count = 0;
  for (let i = Buffer.from(bytes).indexOf(needle); i !== -1; ) {
    count += 1;
    i = Buffer.from(bytes).indexOf(needle, i + needle.length);
  }
  return count;
}

// The WebSocket stream carries BSON documents. They are not decoded here:
// the element names are plain ASCII, which is enough to tell a finished
// checkpoint and to count rows. A row's `op_id` is a BSON string (type 0x02);
// a checkpoint's `last_op_id` does not match because of the type byte.
const CHECKPOINT_COMPLETE = Buffer.from("checkpoint_complete\0", "latin1");
const ROW_OP_ID = Buffer.from("\x02op_id\0", "latin1");

async function runSocketConnection(
  url: string,
  token: string,
  stop: AbortSignal,
  result: ConnectionResult
) {
  const startedAt = Date.now();
  try {
    // The app's own client code (@powersync/common, re-exported by the web
    // SDK), loaded here so the tests do not pay for it.
    const { AbstractRemote, FetchStrategy } = await import("@powersync/web");
    class LoadTestRemote extends AbstractRemote {}
    const remote = new LoadTestRemote({
      fetchCredentials: async () => ({ endpoint: url, token }),
    });
    const stream = await remote.socketStreamRaw({
      path: "/sync/stream",
      data: {
        buckets: [],
        include_checksum: true,
        raw_data: true,
        client_id: randomUUID(),
      },
      abortSignal: stop,
      fetchStrategy: FetchStrategy.Buffered,
    });
    for (;;) {
      const { done, value } = await stream.next();
      if (done) break;
      result.firstLineMs ??= Date.now() - startedAt;
      result.rows += countOccurrences(value, ROW_OP_ID);
      if (countOccurrences(value, CHECKPOINT_COMPLETE) > 0) {
        result.syncedMs ??= Date.now() - startedAt;
      }
    }
    if (!stop.aborted) result.failure = "closed by the server";
  } catch (error) {
    if (!stop.aborted) {
      const message = (error as Error).message ?? String(error);
      result.failure = /PSYNC_S\d+/.exec(message)?.[0] ?? message.slice(0, 120);
    }
  }
}

async function runHttpConnection(
  url: string,
  token: string,
  stop: AbortSignal,
  result: ConnectionResult
) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${url}/sync/stream`, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify({
        buckets: [],
        include_checksum: true,
        raw_data: true,
        client_id: randomUUID(),
      }),
      signal: stop,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      result.failure = `HTTP ${response.status} ${text.slice(0, 120)}`.trim();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
        if (!line.trim()) continue;
        result.firstLineMs ??= Date.now() - startedAt;
        const message = JSON.parse(line) as {
          data?: { data?: unknown[] };
          checkpoint_complete?: unknown;
        };
        if (message.data?.data) result.rows += message.data.data.length;
        if (message.checkpoint_complete) {
          result.syncedMs ??= Date.now() - startedAt;
        }
      }
    }
    if (!stop.aborted) result.failure = "closed by the server";
  } catch (error) {
    if (!stop.aborted) {
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      result.failure = cause ?? (error as Error).message;
    }
  }
}

async function accessToken(): Promise<string> {
  const provided = process.env.POWERSYNC_TOKEN?.trim();
  if (provided) return provided;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.QA_EMAIL;
  const password = process.env.QA_PASSWORD;
  if (!supabaseUrl || !key || !email || !password) {
    throw new Error(
      "Set POWERSYNC_TOKEN, or QA_EMAIL, QA_PASSWORD, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }
  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`Could not sign in as ${email}: ${error?.message}`);
  }
  return data.session.access_token;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const options = parseLoadTestArgs(process.argv.slice(2));
  const url = process.env.POWERSYNC_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new Error("Set POWERSYNC_URL to the instance to test.");
  const token = await accessToken();

  console.log(
    `Opening ${options.connections} ${options.transport} connections to ${url} over ${options.rampSeconds}s, then holding ${options.holdSeconds}s.`
  );

  const stop = new AbortController();
  const results: ConnectionResult[] = [];
  const running: Promise<void>[] = [];
  const report = () => {
    const failed = results.filter((r) => r.failure).length;
    const synced = results.filter((r) => r.syncedMs !== null).length;
    console.log(
      `  opened ${results.length}  in sync ${synced}  failed ${failed}`
    );
  };
  const ticker = setInterval(report, 5000);

  const gapMs = (options.rampSeconds * 1000) / options.connections;
  for (let i = 0; i < options.connections; i += 1) {
    const result: ConnectionResult = {
      firstLineMs: null,
      syncedMs: null,
      rows: 0,
      failure: null,
    };
    results.push(result);
    running.push(
      (options.transport === "ws" ? runSocketConnection : runHttpConnection)(
        url,
        token,
        stop.signal,
        result
      )
    );
    if (gapMs > 0) await sleep(gapMs);
  }
  await sleep(options.holdSeconds * 1000);
  clearInterval(ticker);

  // Count before closing: a connection still open here held for the test.
  const failures = results.filter((r) => r.failure);
  const neverSynced = results.filter((r) => !r.failure && r.syncedMs === null);
  const syncedTimes = results.flatMap((r) => r.syncedMs ?? []);
  stop.abort();
  await Promise.allSettled(running);

  console.log("\nResult");
  console.log(`  connections asked     ${options.connections}`);
  console.log(`  still open at the end ${results.length - failures.length}`);
  console.log(`  reached sync          ${syncedTimes.length}`);
  console.log(`  never reached sync    ${neverSynced.length}`);
  console.log(`  failed                ${failures.length}`);
  console.log(
    `  time to sync (ms)     p50 ${percentile(syncedTimes, 50)}  p95 ${percentile(syncedTimes, 95)}  max ${percentile(syncedTimes, 100)}`
  );
  console.log(
    `  rows per connection   ${percentile(
      results.map((r) => r.rows),
      50
    )} (median)`
  );
  if (failures.length > 0) {
    const reasons = new Map<string, number>();
    for (const { failure } of failures) {
      reasons.set(failure!, (reasons.get(failure!) ?? 0) + 1);
    }
    console.log("  failures:");
    for (const [reason, count] of reasons)
      console.log(`    ${count} × ${reason}`);
  }
  if (failures.length > 0 || neverSynced.length > 0) process.exitCode = 1;
}

// Only run when executed, so the tests can import the helpers.
if (process.argv[1]?.endsWith("powersync-load-test.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
