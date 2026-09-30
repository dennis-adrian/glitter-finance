import assert from "node:assert/strict";
import test from "node:test";
import { initialsOf } from "@/lib/utils";

test("avatars show the first two characters of a name or email", () => {
  assert.equal(initialsOf("ana pérez"), "AN");
  assert.equal(initialsOf("  ñandú"), "ÑA");
  assert.equal(initialsOf("vendedor@example.com"), "VE");
});

test("avatars without a name show one placeholder", () => {
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf("   "), "?");
  assert.equal(initialsOf(null), "?");
  assert.equal(initialsOf(undefined), "?");
});
