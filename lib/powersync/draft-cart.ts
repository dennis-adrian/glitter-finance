"use client";

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import type { CartLine } from "@/lib/types";

const draftCartId = "current";
const legacyStorageKey = "glitter-pos-local-v1";
const legacyMigrationKey = "glitter-pos-draft-cart-migrated-v1";
const draftCartMaxAgeMs = 24 * 60 * 60 * 1000;

type DraftCartRow = {
  id: string;
  lines_json: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function isFreshDraftCart(updatedAt: string | null | undefined) {
  return Boolean(
    updatedAt && Date.now() - new Date(updatedAt).getTime() < draftCartMaxAgeMs
  );
}

function normalizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((line): CartLine | null => {
      if (!line || typeof line !== "object") {
        return null;
      }

      const candidate = line as Partial<CartLine>;
      const quantity = candidate.quantity;
      if (
        typeof candidate.productId !== "string" ||
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return null;
      }

      return {
        productId: candidate.productId,
        quantity,
        lineDiscountCents:
          typeof candidate.lineDiscountCents === "number"
            ? candidate.lineDiscountCents
            : undefined,
        lineDiscountReason:
          typeof candidate.lineDiscountReason === "string"
            ? candidate.lineDiscountReason
            : undefined,
      };
    })
    .filter((line): line is CartLine => Boolean(line));
}

function parseLines(linesJson: string): CartLine[] {
  try {
    return normalizeCart(JSON.parse(linesJson));
  } catch {
    return [];
  }
}

export async function loadDraftCartLocal(db: AbstractPowerSyncDatabase) {
  const rows = await db.getAll<DraftCartRow>(
    `SELECT id, lines_json, updated_at FROM draft_cart WHERE id = ? LIMIT 1`,
    [draftCartId]
  );
  const row = rows[0];

  if (!row || !isFreshDraftCart(row.updated_at)) {
    await clearDraftCartLocal(db);
    return { cart: [], updatedAt: null };
  }

  return {
    cart: parseLines(row.lines_json),
    updatedAt: row.updated_at,
  };
}

export async function saveDraftCartLocal(
  db: AbstractPowerSyncDatabase,
  cart: CartLine[],
  updatedAt: string | null
) {
  if (!cart.length || !updatedAt || !isFreshDraftCart(updatedAt)) {
    await clearDraftCartLocal(db);
    return;
  }

  await db.execute(
    `INSERT OR REPLACE INTO draft_cart (id, lines_json, updated_at)
     VALUES (?, ?, ?)`,
    [draftCartId, JSON.stringify(normalizeCart(cart)), updatedAt]
  );
}

export async function clearDraftCartLocal(db: AbstractPowerSyncDatabase) {
  await db.execute(`DELETE FROM draft_cart WHERE id = ?`, [draftCartId]);
}

function readLegacyDraftCart() {
  if (
    typeof window === "undefined" ||
    window.localStorage.getItem(legacyMigrationKey)
  ) {
    return null;
  }

  const raw = window.localStorage.getItem(legacyStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      state?: { cart?: unknown; cartUpdatedAt?: unknown };
    };
    const updatedAt =
      typeof parsed.state?.cartUpdatedAt === "string"
        ? parsed.state.cartUpdatedAt
        : null;

    if (!isFreshDraftCart(updatedAt)) {
      return null;
    }

    const cart = normalizeCart(parsed.state?.cart);
    return cart.length ? { cart, updatedAt } : null;
  } catch {
    return null;
  }
}

export async function migrateLegacyDraftCartLocal(
  db: AbstractPowerSyncDatabase
) {
  const legacy = readLegacyDraftCart();
  if (legacy) {
    await saveDraftCartLocal(db, legacy.cart, legacy.updatedAt);
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(legacyMigrationKey, nowIso());
    window.localStorage.removeItem(legacyStorageKey);
  }
}
