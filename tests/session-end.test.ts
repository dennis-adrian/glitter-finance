// A session that ended on its own while the app was open
// (lib/auth/session-end.ts, shown by components/providers/session-ended-panel.tsx).

import assert from "node:assert/strict";
import test from "node:test";
import {
  isSessionEndEvent,
  sessionEndedCopy,
  sessionEndedWithWork,
} from "@/lib/auth/session-end";

test("only SIGNED_OUT ends the session", () => {
  assert.equal(isSessionEndEvent("SIGNED_OUT"), true);
  for (const event of [
    "INITIAL_SESSION",
    "SIGNED_IN",
    "TOKEN_REFRESHED",
    "USER_UPDATED",
    "PASSWORD_RECOVERY",
  ]) {
    assert.equal(isSessionEndEvent(event), false, event);
  }
});

test("work counts unless the device is known to hold none", () => {
  assert.equal(
    sessionEndedWithWork({ pendingUploadCount: 0, unresolvedFailureCount: 0 }),
    false
  );
  assert.equal(
    sessionEndedWithWork({ pendingUploadCount: 2, unresolvedFailureCount: 0 }),
    true
  );
  assert.equal(
    sessionEndedWithWork({ pendingUploadCount: 0, unresolvedFailureCount: 1 }),
    true
  );
  // An unreadable queue might hold sales: never offer less than with work.
  assert.equal(sessionEndedWithWork(null), true);
});

test("without work, the user is only asked to sign in again", () => {
  const copy = sessionEndedCopy({
    pendingUploadCount: 0,
    unresolvedFailureCount: 0,
  });

  assert.equal(copy.message, "Tu sesión terminó.");
  assert.match(copy.detail, /Iniciá sesión de nuevo/);
  assert.doesNotMatch(copy.detail, /descartalas/);
});

test("with work, it says what signing in again and a deleted account each mean", () => {
  const pending = sessionEndedCopy({
    pendingUploadCount: 3,
    unresolvedFailureCount: 0,
  });
  assert.match(pending.detail, /Hay 3 operaciones sin subir/);
  assert.match(pending.detail, /misma cuenta, se suben solas/);
  assert.match(pending.detail, /descargá una copia y descartalas/);

  assert.match(pending.detail, /antes de iniciar sesión/);

  // Rejected operations do not upload by signing in again.
  const rejected = sessionEndedCopy({
    pendingUploadCount: 0,
    unresolvedFailureCount: 1,
  }).detail;
  assert.match(rejected, /la nube rechazó/);
  assert.match(rejected, /se sube lo que la nube acepte/);
  assert.doesNotMatch(rejected, /se suben solas/);
  const mixed = sessionEndedCopy({
    pendingUploadCount: 2,
    unresolvedFailureCount: 1,
  }).detail;
  assert.match(mixed, /Algunas fueron rechazadas/);
  assert.doesNotMatch(mixed, /se suben solas/);
  assert.match(sessionEndedCopy(null).detail, /No se pudo comprobar/);
});

test("a session end is never reported as a removal from the puesto", () => {
  for (const work of [
    null,
    { pendingUploadCount: 0, unresolvedFailureCount: 0 },
  ]) {
    assert.doesNotMatch(
      `${sessionEndedCopy(work).message} ${sessionEndedCopy(work).detail}`,
      /Ya no sos parte/
    );
  }
});
