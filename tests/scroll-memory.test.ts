import assert from "node:assert/strict";
import test from "node:test";
import { createScrollMemory } from "@/lib/scroll-memory";

test("a saved scroll position is given back once", () => {
  const memory = createScrollMemory();
  assert.equal(memory.take(), null);

  memory.save(640);
  memory.save(720);
  assert.equal(memory.take(), 720);
  assert.equal(memory.take(), null);
});
