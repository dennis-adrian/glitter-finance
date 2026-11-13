import assert from "node:assert/strict";
import test from "node:test";
import { parseSupportContact } from "@/lib/support-contact";

test("hides both channels when nothing is configured", () => {
  assert.deepEqual(parseSupportContact({}), { email: null, whatsapp: null });
  assert.deepEqual(
    parseSupportContact({
      NEXT_PUBLIC_SUPPORT_EMAIL: "  ",
      NEXT_PUBLIC_SUPPORT_WHATSAPP: "",
    }),
    { email: null, whatsapp: null }
  );
});

test("builds a mailto link with a subject", () => {
  const { email, whatsapp } = parseSupportContact({
    NEXT_PUBLIC_SUPPORT_EMAIL: " soporte@example.com ",
  });
  assert.deepEqual(email, {
    address: "soporte@example.com",
    href: "mailto:soporte@example.com?subject=Ayuda%20con%20Billetera%20Ferial",
  });
  assert.equal(whatsapp, null);
});

test("ignores an address that is not an email", () => {
  for (const value of ["soporte", "soporte@example", "a b@example.com"]) {
    assert.equal(
      parseSupportContact({ NEXT_PUBLIC_SUPPORT_EMAIL: value }).email,
      null,
      value
    );
  }
});

test("builds a wa.me link from an international number", () => {
  const { whatsapp } = parseSupportContact({
    NEXT_PUBLIC_SUPPORT_WHATSAPP: "+591 (700) 00-000",
  });
  assert.equal(whatsapp?.display, "+59170000000");
  assert.equal(
    whatsapp?.href,
    "https://wa.me/59170000000?text=Hola%2C%20necesito%20ayuda%20con%20Billetera%20Ferial."
  );
});

test("ignores a WhatsApp value that is not a phone number", () => {
  for (const value of [
    "70000",
    "wa.me/59170000000",
    "+591 7000 0000 0000 00",
  ]) {
    assert.equal(
      parseSupportContact({ NEXT_PUBLIC_SUPPORT_WHATSAPP: value }).whatsapp,
      null,
      value
    );
  }
});
