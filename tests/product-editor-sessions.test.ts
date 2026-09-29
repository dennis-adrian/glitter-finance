import assert from "node:assert/strict";
import test from "node:test";
import { createProductEditorSessions } from "@/lib/product-editor-sessions";

type Created = { id: string };

test("a retry in the editor that created a product updates it", () => {
  const sessions = createProductEditorSessions<Created>();
  const session = sessions.next();

  assert.equal(sessions.createdIn(session), null);
  sessions.rememberCreated(session, { id: "a" });
  // The photo upload failed and the user taps Guardar again.
  assert.deepEqual(sessions.createdIn(sessions.current()), { id: "a" });
});

test("a save that finishes after its editor closed is not kept for the next one", () => {
  const sessions = createProductEditorSessions<Created>();
  const saving = sessions.next();

  // Volver, then '+', while the save of product A still runs.
  sessions.next();
  const reopened = sessions.next();
  sessions.rememberCreated(saving, { id: "a" });

  assert.equal(sessions.current(), reopened);
  assert.equal(sessions.createdIn(reopened), null);
  assert.equal(sessions.createdIn(saving), null);
});

test("a product created in one session is forgotten once the editor opens again", () => {
  const sessions = createProductEditorSessions<Created>();
  const first = sessions.next();
  sessions.rememberCreated(first, { id: "a" });

  const second = sessions.next();
  assert.equal(sessions.createdIn(second), null);
  assert.equal(sessions.createdIn(first), null);
});
