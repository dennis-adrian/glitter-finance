import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseLoadTestArgs, percentile } from "../scripts/powersync-load-test";

const dir = "powersync/self-hosted";
const compose = readFileSync(`${dir}/docker-compose.yaml`, "utf8");
const service = readFileSync(`${dir}/service.yaml`, "utf8");
const caddyfile = readFileSync(`${dir}/Caddyfile`, "utf8");
const envExample = readFileSync(`${dir}/.env.example`, "utf8");

test("the self-hosted service reads the repository's sync rules", () => {
  assert.match(
    compose,
    /- \.\.\/sync-rules\.yaml:\/config\/sync-config\.yaml:ro/
  );
  assert.match(service, /sync_config:\n\s+path: sync-config\.yaml/);
});

test("the PowerSync image is pinned to a version", () => {
  const images = [...compose.matchAll(/image: (journeyapps\/\S+)/g)].map(
    (match) => match[1]
  );
  assert.equal(images.length, 1);
  assert.match(images[0], /:\d+\.\d+\.\d+$/);
});

test("the proxy forwards to the port the service listens on", () => {
  const port = /^port: (\d+)$/m.exec(service)?.[1];
  assert.ok(port);
  assert.match(caddyfile, new RegExp(`port ${port}\\b`));
  assert.ok(compose.includes(`http://localhost:${port}/probes/liveness`));
});

test("device tokens are checked as Supabase sessions", () => {
  assert.match(service, /^\s+supabase: true$/m);
  assert.match(service, /^\s+audience: \["authenticated"\]$/m);
});

test("every variable the stack reads is in .env.example", () => {
  const used = new Set(
    [...compose.matchAll(/\$\{(PS_[A-Z_]+)/g)].map((match) => match[1])
  );
  assert.ok(used.size >= 4);
  for (const name of used) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"), name);
  }
});

test("every variable service.yaml substitutes is set by the compose file", () => {
  const substituted = [...service.matchAll(/!env (PS_[A-Z_]+)/g)].map(
    (match) => match[1]
  );
  assert.ok(substituted.length >= 3);
  for (const name of substituted) {
    assert.match(compose, new RegExp(`^\\s+${name}: `, "m"), name);
  }
});

test("parseLoadTestArgs reads the options and keeps the defaults", () => {
  assert.deepEqual(parseLoadTestArgs([]), {
    connections: 100,
    rampSeconds: 30,
    holdSeconds: 60,
  });
  assert.deepEqual(
    parseLoadTestArgs(["--", "--connections", "300", "--hold", "0"]),
    { connections: 300, rampSeconds: 30, holdSeconds: 0 }
  );
});

test("parseLoadTestArgs rejects unknown and malformed options", () => {
  assert.throws(() => parseLoadTestArgs(["--conections", "3"]), /Unknown/);
  assert.throws(() => parseLoadTestArgs(["--connections", "many"]), /whole/);
  assert.throws(() => parseLoadTestArgs(["--connections", "0"]), />= 1/);
  assert.throws(() => parseLoadTestArgs(["--ramp"]), /whole/);
});

test("percentile picks the nearest rank", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([4, 1, 3, 2], 50), 2);
  assert.equal(percentile([4, 1, 3, 2], 100), 4);
});
