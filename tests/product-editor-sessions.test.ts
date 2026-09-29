import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductEditorSessions,
  editorPendingWrite,
} from "@/lib/product-editor-sessions";

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

test("the editor waits for every product write, and names only its own", () => {
  assert.equal(editorPendingWrite(null, 3), null);
  assert.equal(
    editorPendingWrite({ kind: "save", productId: null, editorSession: 3 }, 3),
    "save"
  );
  assert.equal(
    editorPendingWrite(
      { kind: "archive", productId: "a", editorSession: 3 },
      3
    ),
    "archive"
  );
  // A restore tapped in the catalog just before this editor opened.
  assert.equal(
    editorPendingWrite({ kind: "restore", productId: "x" }, 3),
    "busy"
  );
  // The save of an editor closed since.
  assert.equal(
    editorPendingWrite({ kind: "save", productId: null, editorSession: 1 }, 3),
    "busy"
  );
});
