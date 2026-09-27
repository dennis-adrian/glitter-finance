import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PASSWORD_LENGTH,
  newPasswordError,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORDS_DO_NOT_MATCH_MESSAGE,
} from "@/lib/auth/password";

test("a new password needs the minimum length and a matching confirmation", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(newPasswordError("", ""), PASSWORD_TOO_SHORT_MESSAGE);
  assert.equal(
    newPasswordError("1234567", "1234567"),
    PASSWORD_TOO_SHORT_MESSAGE
  );
  assert.equal(
    newPasswordError("12345678", "12345679"),
    PASSWORDS_DO_NOT_MATCH_MESSAGE
  );
  assert.equal(newPasswordError("12345678", "12345678"), null);
  assert.equal(
    PASSWORD_TOO_SHORT_MESSAGE,
    "La contraseña debe tener al menos 8 caracteres."
  );
});
