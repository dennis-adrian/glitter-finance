import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { randomUuid } from "@/lib/uuid";
import { isUuid, requireUuid } from "@/lib/validation";

const V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// crypto outside a secure context: getRandomValues only.
const insecureCrypto = {
  getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array),
};

function filledWith(byte: number) {
  return {
    getRandomValues: (array: Uint8Array) => array.fill(byte),
  };
}

test("uses crypto.randomUUID when the context has it", () => {
  const id = randomUuid({
    getRandomValues: () => {
      throw new Error("not expected");
    },
    randomUUID: () => "0f6b1c2a-9d3e-4f5a-8b7c-6d5e4f3a2b1c",
  });
  assert.equal(id, "0f6b1c2a-9d3e-4f5a-8b7c-6d5e4f3a2b1c");
  assert.match(randomUuid(), V4_RE);
});

test("builds a version 4 UUID the server accepts without crypto.randomUUID", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const id = randomUuid(insecureCrypto);
    assert.match(id, V4_RE);
    assert.equal(isUuid(id), true);
    assert.equal(requireUuid(id, "x"), id);
    ids.add(id);
  }
  assert.equal(ids.size, 200);
});

test("sets the version and variant bits whatever the random bytes are", () => {
  assert.equal(
    randomUuid(filledWith(0x00)),
    "00000000-0000-4000-8000-000000000000"
  );
  assert.equal(
    randomUuid(filledWith(0xff)),
    "ffffffff-ffff-4fff-bfff-ffffffffffff"
  );
});
