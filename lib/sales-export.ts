import {
  BOLIVIA_TIME_ZONE,
  formatDateInputInBolivia,
  type SalesRangeBounds,
} from "@/lib/dates";
import {
  allocateProportionally,
  paymentLabels,
  saleAppliedDiscountCents,
  saleLineNetCents,
  sortSalesNewestFirst,
} from "@/lib/sales";
import type { Sale } from "@/lib/types";

/**
 * The sales of a range as a CSV file for a spreadsheet: one row per sale
 * line, the export PRD section 11.13 describes. Its figures are the ones
 * Reports shows for the same sales (computeMetrics and the breakdowns in
 * lib/sales.ts), row by row:
 *
 * - A voided sale never happened as far as reports go, so it has no rows.
 * - A refund is its own rows, dated when it was issued, with its quantities
 *   and amounts negative; the refunded sale keeps its positive rows (Estado
 *   "Reembolsada"), so the two net out when both are in the range, and a
 *   refund of an earlier sale takes its amount off this one, as in Reports.
 * - The sale-level discount is split across the sale's lines in proportion
 *   to their totals, in whole cents, exactly as the category and product
 *   breakdowns split it (saleLineNetCents), so "Total neto" adds up to the
 *   net revenue.
 * - A line whose product had no recorded cost leaves both cost cells empty.
 *   A spreadsheet adds an empty cell as 0, as Reports does when it marks
 *   cost as incomplete, so "Total neto" less "Costo total" is Reports'
 *   net earnings: an upper bound while any cost cell is empty.
 *
 * The format targets Excel and Google Sheets in a Spanish locale: UTF-8
 * with a BOM, ";" between fields and "," before decimals (Spanish Excel
 * splits on ";" and reads "12,50" as a number), CRLF line ends, amounts in
 * Bs. without grouping or a currency sign, and dates as
 * "yyyy-mm-dd hh:mm:ss" in Bolivian time, which both read as a date in any
 * locale.
 */

export const CSV_DELIMITER = ";";
const CSV_LINE_END = "\r\n";
/** The byte-order mark Excel needs to read the file as UTF-8. */
export const UTF8_BOM = String.fromCharCode(0xfeff);
export const SALES_CSV_MIME_TYPE = "text/csv;charset=utf-8";

export const SALES_CSV_HEADERS = [
  "Fecha y hora (Bolivia)",
  "Tipo",
  "Estado",
  "ID de venta",
  "ID de venta original",
  "Producto",
  "Categoría",
  "Cantidad",
  "Precio unitario (Bs)",
  "Subtotal (Bs)",
  "Descuento de línea (Bs)",
  "Descuento de venta prorrateado (Bs)",
  "Total neto (Bs)",
  "Costo unitario (Bs)",
  "Costo total (Bs)",
  "Método de pago",
  "Registró",
  "Vendedor",
  "Motivo del reembolso",
] as const;

/** One sale line as the export lists it, amounts in cents, signed. */
export type SalesExportRow = {
  saleId: string;
  /** When the sale (or the refund) was recorded, as stored. */
  createdAt: string;
  kind: "sale" | "refund";
  /** "completed" or "refunded" on a sale; "refund" on a refund record. */
  status: "completed" | "refunded" | "refund";
  originalSaleId: string | null;
  productName: string;
  category: string;
  /** Negative on a refund. */
  quantity: number;
  unitPriceCents: number;
  /** Unit price × quantity, before any discount. */
  grossCents: number;
  lineDiscountCents: number;
  /** This line's share of the sale-level discount. */
  saleDiscountCents: number;
  netCents: number;
  unitCostCents: number | null;
  costCents: number | null;
  paymentMethodLabel: string;
  /** Who recorded the sale, or the refund. */
  recordedBy: string;
  /** Who the reports credit: on a refund, whoever made the original sale. */
  seller: string;
  refundReason: string;
};

/** A refund record takes its amounts back; `0 - x` keeps 0 from being -0. */
function signedFor(sale: Sale) {
  return (amount: number) => (sale.refundOfSaleId ? 0 - amount : amount);
}

export type SalesExportOptions = {
  /**
   * The ids of the sales that have a refund. The loaders mark only the
   * refund record "refunded", not the sale it returns, so this comes from
   * every loaded sale: a refund issued after the range still marks its sale.
   * Defaults to the refunds among the exported sales.
   */
  refundedSaleIds?: ReadonlySet<string>;
};

/** The ids of the sales that `sales` holds a refund of. */
export function refundedSaleIdsOf(sales: readonly Sale[]): Set<string> {
  return new Set(
    sales.flatMap((sale) =>
      sale.refundOfSaleId && sale.status !== "voided"
        ? [sale.refundOfSaleId]
        : []
    )
  );
}

/** The export rows of one sale, none for a voided sale. */
export function saleExportRows(
  sale: Sale,
  refundedSaleIds: ReadonlySet<string> = new Set()
): SalesExportRow[] {
  if (sale.status === "voided") return [];

  const sign = signedFor(sale);
  const isRefund = Boolean(sale.refundOfSaleId);
  const nets = saleLineNetCents(sale);
  const saleDiscounts = allocateProportionally(
    saleAppliedDiscountCents(sale),
    sale.lines.map((line) => line.lineTotalCents)
  );
  const seller = isRefund
    ? (sale.refundOfSaleUserName ?? sale.userName)
    : sale.userName;

  return sale.lines.map((line, index) => ({
    saleId: sale.id,
    createdAt: sale.createdAt,
    kind: isRefund ? "refund" : "sale",
    status: isRefund
      ? "refund"
      : sale.status === "refunded" || refundedSaleIds.has(sale.id)
        ? "refunded"
        : "completed",
    originalSaleId: sale.refundOfSaleId ?? null,
    productName: line.productName,
    category: line.category,
    quantity: sign(line.quantity),
    unitPriceCents: line.unitPriceCents,
    grossCents: sign(line.unitPriceCents * line.quantity),
    lineDiscountCents: sign(line.lineDiscountCents),
    saleDiscountCents: sign(saleDiscounts[index]),
    netCents: nets[index],
    unitCostCents: line.unitCostCents,
    costCents:
      line.unitCostCents == null
        ? null
        : sign(line.unitCostCents * line.quantity),
    paymentMethodLabel: paymentLabels[sale.paymentMethod],
    recordedBy: sale.userName,
    seller,
    refundReason: isRefund ? (sale.refundReason ?? "") : "",
  }));
}

/** Oldest first: the order a ledger is read in. */
export function sortSalesOldestFirst(sales: readonly Sale[]): Sale[] {
  return sortSalesNewestFirst(sales).reverse();
}

/** Every row of `sales`, oldest sale first. */
export function salesExportRows(
  sales: readonly Sale[],
  { refundedSaleIds = refundedSaleIdsOf(sales) }: SalesExportOptions = {}
): SalesExportRow[] {
  return sortSalesOldestFirst(sales).flatMap((sale) =>
    saleExportRows(sale, refundedSaleIds)
  );
}

/**
 * What the export holds, counted as Reports counts it: sales (refunded
 * later or not) and refunds, voided ones left out.
 */
export function countExportedSales(sales: readonly Sale[]) {
  let saleCount = 0;
  let refundCount = 0;
  for (const sale of sales) {
    if (sale.status === "voided" || !sale.lines.length) continue;
    if (sale.refundOfSaleId) refundCount += 1;
    else saleCount += 1;
  }
  return { saleCount, refundCount };
}

const STATUS_LABELS: Record<SalesExportRow["status"], string> = {
  completed: "Completada",
  refunded: "Reembolsada",
  refund: "Reembolso",
};

const KIND_LABELS: Record<SalesExportRow["kind"], string> = {
  sale: "Venta",
  refund: "Reembolso",
};

/**
 * Cents as a plain decimal number with "," before the cents: 1250 → "12,50",
 * -5 → "-0,05". No grouping and no currency sign, so a spreadsheet in a
 * Spanish locale reads it as a number. Integer arithmetic, so no float
 * rounding.
 */
export function formatCsvAmount(cents: number) {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${whole},${fraction}`;
}

const csvDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BOLIVIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "2026-09-26 14:30:05" in Bolivian time; empty for an unreadable date. */
export function formatCsvDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    csvDateFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// A cell a spreadsheet would run as a formula: one that starts with = + - @,
// or with a tab or carriage return ahead of one (OWASP, "CSV Injection").
const FORMULA_START_RE = /^[=+\-@\t\r]/;

/**
 * A text cell, safe to open: a value a spreadsheet would read as a formula
 * gets a leading apostrophe, which shows the text as typed. Only text cells
 * pass through here, so negative amounts stay numbers.
 */
export function neutralizeFormula(value: string) {
  return FORMULA_START_RE.test(value) ? `'${value}` : value;
}

/** A field quoted when it holds the delimiter, a quote or a line break. */
export function quoteCsvField(value: string) {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function textCell(value: string) {
  return quoteCsvField(neutralizeFormula(value));
}

function amountCell(cents: number | null) {
  return cents == null ? "" : formatCsvAmount(cents);
}

function csvLine(cells: readonly string[]) {
  return cells.join(CSV_DELIMITER) + CSV_LINE_END;
}

export function salesCsvHeaderLine() {
  return csvLine(SALES_CSV_HEADERS.map(textCell));
}

export function salesCsvRowLine(row: SalesExportRow) {
  return csvLine([
    formatCsvDateTime(row.createdAt),
    textCell(KIND_LABELS[row.kind]),
    textCell(STATUS_LABELS[row.status]),
    textCell(row.saleId),
    textCell(row.originalSaleId ?? ""),
    textCell(row.productName),
    textCell(row.category),
    String(row.quantity),
    amountCell(row.unitPriceCents),
    amountCell(row.grossCents),
    amountCell(row.lineDiscountCents),
    amountCell(row.saleDiscountCents),
    amountCell(row.netCents),
    amountCell(row.unitCostCents),
    amountCell(row.costCents),
    textCell(row.paymentMethodLabel),
    textCell(row.recordedBy),
    textCell(row.seller),
    textCell(row.refundReason),
  ]);
}

/** How many sales each chunk of salesCsvChunks holds. */
export const SALES_CSV_CHUNK_SALES = 100;

/**
 * The CSV in pieces: the BOM and header first, then the rows of
 * `chunkSales` sales at a time, so a caller can hand control back to the
 * browser between pieces and a long range does not freeze the screen. The
 * pieces joined (or passed to a Blob) are the whole file.
 */
export function* salesCsvChunks(
  sales: readonly Sale[],
  {
    refundedSaleIds = refundedSaleIdsOf(sales),
    chunkSales = SALES_CSV_CHUNK_SALES,
  }: SalesExportOptions & { chunkSales?: number } = {}
): Generator<string> {
  yield UTF8_BOM + salesCsvHeaderLine();
  const sorted = sortSalesOldestFirst(sales);
  for (let start = 0; start < sorted.length; start += chunkSales) {
    let chunk = "";
    for (const sale of sorted.slice(start, start + chunkSales)) {
      for (const row of saleExportRows(sale, refundedSaleIds)) {
        chunk += salesCsvRowLine(row);
      }
    }
    if (chunk) yield chunk;
  }
}

/** The whole CSV as one string. */
export function salesCsv(
  sales: readonly Sale[],
  options: SalesExportOptions = {}
) {
  return [...salesCsvChunks(sales, options)].join("");
}

/** Hands control back to the browser: lets it paint and handle input. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The pieces of salesCsvChunks, awaiting `pause` between them so building
 * a long range does not block the main thread for its whole length.
 */
export async function buildSalesCsvChunks(
  sales: readonly Sale[],
  {
    pause = yieldToBrowser,
    ...options
  }: SalesExportOptions & { pause?: () => Promise<void> } = {}
): Promise<string[]> {
  const chunks: string[] = [];
  for (const chunk of salesCsvChunks(sales, options)) {
    chunks.push(chunk);
    await pause();
  }
  return chunks;
}

/**
 * A puesto name as a filename part: no accents, lowercase, letters and
 * digits joined by "-" ("Café Ñandú" → "cafe-nandu"), "puesto" when nothing
 * is left.
 */
export function filenameSlug(name: string) {
  const slug = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "puesto";
}

/**
 * "ventas-<puesto>-2026-09-01-a-2026-09-30.csv", or one date for a single
 * day. The dates are the range's first and last Bolivian calendar days.
 */
export function salesCsvFilename(tenantName: string, bounds: SalesRangeBounds) {
  const first = formatDateInputInBolivia(new Date(bounds.start));
  const last = formatDateInputInBolivia(new Date(bounds.end - 1));
  const dates = first === last ? first : `${first}-a-${last}`;
  return `ventas-${filenameSlug(tenantName)}-${dates}.csv`;
}
