import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "crypto";
import { getServerEnv } from "@/lib/env";

function requireSecretKey(): string {
  const secret = getServerEnv().invitationSecretKey;
  if (!secret) {
    throw new Error("Missing required environment variable: INVITATION_SECRET_KEY");
  }
  return secret;
}

function deriveKey(info: string): Buffer {
  return createHmac("sha256", info).update(requireSecretKey()).digest();
}

function encryptionKey(): Buffer {
  return deriveKey("invitation-delivery-encrypt-v1");
}

function hmacKey(): Buffer {
  return deriveKey("invitation-token-hash-v1");
}

export function hashInvitationToken(rawToken: string): string {
  return createHmac("sha256", hmacKey()).update(rawToken).digest("base64url");
}

export function encryptInvitationDeliveryToken(rawToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(rawToken, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptInvitationDeliveryToken(
  ciphertext: string
): string | null {
  try {
    const packed = Buffer.from(ciphertext, "base64url");
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    return null;
  }
}
