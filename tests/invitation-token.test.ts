// Invitation links carry a bearer token. The database keeps only an HMAC of
// it for lookup, plus an AES-GCM ciphertext so Settings can show the link
// again; both keys derive from INVITATION_SECRET_KEY.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { stubModule, withEnv } from "./support/stub-module";

stubModule("server-only", {});

// getServerEnv requires these as well.
const OTHER_SERVER_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  SUPABASE_SECRET_KEY: "secret-key",
};

const TOKEN = "k3J9x2mQ7pLr8vT1wZ4yB6nC0dF5gH";

async function withKey<T>(
  key: string,
  run: (token: typeof import("@/lib/invitations/token")) => T
) {
  const token = await import("@/lib/invitations/token");
  return withEnv(
    [],
    { ...OTHER_SERVER_ENV, INVITATION_SECRET_KEY: key },
    async () => run(token)
  );
}

test("the lookup hash is stable, url-safe and never the token itself", async () => {
  await withKey("invitation-secret-a", ({ hashInvitationToken }) => {
    const hash = hashInvitationToken(TOKEN);
    assert.equal(hashInvitationToken(TOKEN), hash);
    assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(hash, TOKEN);
    assert.notEqual(hashInvitationToken(`${TOKEN}x`), hash);
  });
});

test("the delivery ciphertext decrypts back to the token", async () => {
  await withKey(
    "invitation-secret-a",
    ({ encryptInvitationDeliveryToken, decryptInvitationDeliveryToken }) => {
      const first = encryptInvitationDeliveryToken(TOKEN);
      const second = encryptInvitationDeliveryToken(TOKEN);
      // A fresh IV each time: equal tokens do not give equal ciphertexts.
      assert.notEqual(first, second);
      assert.doesNotMatch(first, new RegExp(TOKEN));
      assert.equal(decryptInvitationDeliveryToken(first), TOKEN);
      assert.equal(decryptInvitationDeliveryToken(second), TOKEN);
    }
  );
});

test("a tampered or malformed ciphertext decrypts to null", async () => {
  await withKey(
    "invitation-secret-a",
    ({ encryptInvitationDeliveryToken, decryptInvitationDeliveryToken }) => {
      const packed = Buffer.from(
        encryptInvitationDeliveryToken(TOKEN),
        "base64url"
      );
      // IV (12 bytes), then the GCM tag (16 bytes), then the encrypted token.
      for (const index of [0, 12, packed.length - 1]) {
        const tampered = Buffer.from(packed);
        tampered[index] ^= 0x01;
        assert.equal(
          decryptInvitationDeliveryToken(tampered.toString("base64url")),
          null,
          `byte ${index}`
        );
      }
      for (const malformed of [
        "",
        "not base64!",
        packed.subarray(0, 27).toString("base64url"),
      ]) {
        assert.equal(decryptInvitationDeliveryToken(malformed), null);
      }
    }
  );
});

test("each server key gives its own hash and ciphertext", async () => {
  const hashA = await withKey("invitation-secret-a", (token) =>
    token.hashInvitationToken(TOKEN)
  );
  const cipherA = await withKey("invitation-secret-a", (token) =>
    token.encryptInvitationDeliveryToken(TOKEN)
  );

  await withKey("invitation-secret-b", (token) => {
    // Rotating the key invalidates existing links rather than accepting them.
    assert.notEqual(token.hashInvitationToken(TOKEN), hashA);
    assert.equal(token.decryptInvitationDeliveryToken(cipherA), null);
  });
});

test("the hash key is derived, not the secret itself", async () => {
  await withKey("invitation-secret-a", ({ hashInvitationToken }) => {
    const withRawSecret = createHmac("sha256", "invitation-secret-a")
      .update(TOKEN)
      .digest("base64url");
    assert.notEqual(hashInvitationToken(TOKEN), withRawSecret);
  });
});

test("a missing server key fails instead of hashing with an empty key", async () => {
  const token = await import("@/lib/invitations/token");
  await withEnv(["INVITATION_SECRET_KEY"], OTHER_SERVER_ENV, async () => {
    assert.throws(
      () => token.hashInvitationToken(TOKEN),
      /INVITATION_SECRET_KEY/
    );
  });
});
