/** The part of Web Crypto randomUuid needs; randomUUID may be missing. */
type UuidSource = {
  getRandomValues(array: Uint8Array): Uint8Array;
  randomUUID?: () => string;
};

/**
 * A random (version 4) UUID. Browsers expose crypto.randomUUID only in a
 * secure context (HTTPS or localhost), so the app opened over plain http, e.g.
 * on a phone at a LAN address, builds one from crypto.getRandomValues, which
 * every context has.
 */
export function randomUuid(source: UuidSource = globalThis.crypto): string {
  if (typeof source.randomUUID === "function") {
    return source.randomUUID();
  }

  const bytes = source.getRandomValues(new Uint8Array(16));
  // RFC 9562: version 4 in the high nibble of byte 6, variant 10 in the high
  // bits of byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 16),
  ]
    .map((group) => group.join(""))
    .join("-");
}
