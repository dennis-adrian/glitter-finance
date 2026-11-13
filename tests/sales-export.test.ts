import assert from "node:assert/strict";
import test from "node:test";
import { filterSalesByBounds, resolveSalesRange } from "@/lib/dates";
import {
  computeCategoryTotals,
  computeMetrics,
  computePaymentTotals,
  computeProductTotals,
  computeUserTotals,
} from "@/lib/sales";
import {
  buildSalesCsvChunks,
  countExportedSales,
  filenameSlug,
  formatCsvAmount,
  formatCsvDateTime,
  neutralizeFormula,
  quoteCsvField,
  SALES_CSV_HEADERS,
  salesCsv,
  salesCsvChunks,
  salesCsvFilename,
  refundedSaleIdsOf,
  UTF8_BOM,
} from "@/lib/sales-export";
import { saveFileMethod } from "@/lib/save-file";
import type { Sale, SaleLine } from "@/lib/types";

function line(
  id: string,
  quantity: number,
  unitPriceCents: number,
  unitCostCents: number | null,
  lineDiscountCents = 0,
  productName = `Producto ${id}`,
  category = "Prints"
): SaleLine {
  return {
    id: `line-${id}-${quantity}-${unitPriceCents}`,
    productId: id,
    productName,
    category,
    quantity,
    unitPriceCents,
    unitCostCents,
    lineDiscountCents,
    lineTotalCents: unitPriceCents * quantity - lineDiscountCents,
  };
}

function sale(overrides: Partial<Sale> & Pick<Sale, "id" | "lines">): Sale {
  return {
    tenantId: "t",
    userId: "ana",
    userName: "Ana",
    createdAt: "2026-09-26T18:30:05.000Z",
    paymentMethod: "cash",
    saleDiscountCents: 0,
    status: "completed",
    ...overrides,
  };
}

/** RFC 4180 with ";" between fields, as Excel and Google Sheets read it. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ";") {
      row.push(field);
      field = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else {
      field += char;
    }
  }
  assert.equal(field, "", "the file ends with a line break");
  return rows;
}

/** A spreadsheet's reading of an amount cell, in cents; empty is 0. */
function cents(cell: string) {
  if (cell === "") return 0;
  assert.match(cell, /^-?\d+,\d{2}$/);
  const negative = cell.startsWith("-");
  const [whole, fraction] = cell.replace("-", "").split(",");
  const value = Number(whole) * 100 + Number(fraction);
  return negative ? -value : value;
}

/** The parsed data rows, as objects keyed by header. */
function records(csv: string) {
  assert.equal(csv.charCodeAt(0), 0xfeff, "UTF-8 BOM");
  const [header, ...rows] = parseCsv(csv.slice(1));
  assert.deepEqual(header, [...SALES_CSV_HEADERS]);
  return rows.map((row) => {
    assert.equal(row.length, header.length);
    return Object.fromEntries(header.map((name, index) => [name, row[index]]));
  });
}

function sum(rows: Record<string, string>[], column: string) {
  return rows.reduce((total, row) => total + cents(row[column]), 0);
}

test("amounts are plain decimals with a decimal comma", () => {
  assert.equal(formatCsvAmount(0), "0,00");
  assert.equal(formatCsvAmount(1250), "12,50");
  assert.equal(formatCsvAmount(123456789), "1234567,89");
  assert.equal(formatCsvAmount(-5), "-0,05");
  assert.equal(formatCsvAmount(-1200), "-12,00");
});

test("dates are Bolivian local time in yyyy-mm-dd hh:mm:ss", () => {
  assert.equal(
    formatCsvDateTime("2026-09-26T18:30:05.000Z"),
    "2026-09-26 14:30:05"
  );
  // Past midnight UTC is still the evening before in La Paz.
  assert.equal(
    formatCsvDateTime("2026-09-27T02:05:00.000Z"),
    "2026-09-26 22:05:00"
  );
  assert.equal(
    formatCsvDateTime("2026-09-26T04:00:00.000Z"),
    "2026-09-26 00:00:00"
  );
  assert.equal(formatCsvDateTime("no es una fecha"), "");
});

test("fields with the delimiter, quotes or line breaks are quoted", () => {
  assert.equal(quoteCsvField("Sticker"), "Sticker");
  assert.equal(quoteCsvField("Sticker, grande"), "Sticker, grande");
  assert.equal(quoteCsvField("Pack; x3"), '"Pack; x3"');
  assert.equal(quoteCsvField('Print "A4"'), '"Print ""A4"""');
  assert.equal(quoteCsvField("Línea\nnueva"), '"Línea\nnueva"');
  assert.equal(quoteCsvField("a\r\nb"), '"a\r\nb"');
});

test("text that a spreadsheet would run as a formula is neutralized", () => {
  for (const value of [
    '=HYPERLINK("http://x")',
    "+54",
    "-2+3",
    "@SUM(A1)",
    "\t=1",
    "\r=1",
  ]) {
    assert.equal(neutralizeFormula(value), `'${value}`);
  }
  assert.equal(neutralizeFormula("Sticker = feliz"), "Sticker = feliz");
  assert.equal(neutralizeFormula(""), "");
});

test("a product name round-trips through quoting and the formula guard", () => {
  const name = '=Pack; "x3"\nedición';
  const csv = salesCsv([
    sale({ id: "s1", lines: [line("p", 1, 1000, 400, 0, name, "@Cat")] }),
  ]);
  const [row] = records(csv);
  assert.equal(row["Producto"], `'${name}`);
  assert.equal(row["Categoría"], "'@Cat");
  // Numbers are not text cells: a negative amount stays a number.
  const refund = records(
    salesCsv([
      sale({
        id: "r1",
        status: "refunded",
        refundOfSaleId: "s1",
        lines: [line("p", 1, 1000, 400)],
      }),
    ])
  )[0];
  assert.equal(refund["Total neto (Bs)"], "-10,00");
  assert.equal(refund["Cantidad"], "-1");
});

test("each line is a row with its snapshotted figures", () => {
  const csv = salesCsv([
    sale({
      id: "s1",
      userName: "Ana",
      paymentMethod: "qr_transfer",
      saleDiscountCents: 100,
      lines: [
        line("sticker", 2, 1500, 500, 200, "Sticker"),
        line("print", 1, 1000, null, 0, "Print"),
      ],
    }),
  ]);
  const rows = records(csv);
  assert.deepEqual(rows[0], {
    "Fecha y hora (Bolivia)": "2026-09-26 14:30:05",
    Tipo: "Venta",
    Estado: "Completada",
    "ID de venta": "s1",
    "ID de venta original": "",
    Producto: "Sticker",
    Categoría: "Prints",
    Cantidad: "2",
    "Precio unitario (Bs)": "15,00",
    "Subtotal (Bs)": "30,00",
    "Descuento de línea (Bs)": "2,00",
    // 100 split 2800 : 1000.
    "Descuento de venta prorrateado (Bs)": "0,74",
    "Total neto (Bs)": "27,26",
    "Costo unitario (Bs)": "5,00",
    "Costo total (Bs)": "10,00",
    "Método de pago": "QR",
    Registró: "Ana",
    Vendedor: "Ana",
    "Motivo del reembolso": "",
  });
  // No recorded cost: both cost cells empty.
  assert.equal(rows[1]["Costo unitario (Bs)"], "");
  assert.equal(rows[1]["Costo total (Bs)"], "");
  assert.equal(rows[1]["Descuento de venta prorrateado (Bs)"], "0,26");
  assert.equal(rows[1]["Total neto (Bs)"], "9,74");
});

test("voided sales have no rows; refunds are their own negative rows", () => {
  const original = sale({
    id: "s1",
    userId: "bea",
    userName: "Bea",
    status: "refunded",
    lines: [line("p", 2, 1000, 300)],
  });
  const csv = salesCsv([
    sale({
      id: "r1",
      createdAt: "2026-09-26T19:00:00.000Z",
      status: "refunded",
      refundOfSaleId: "s1",
      refundOfSaleUserId: "bea",
      refundOfSaleUserName: "Bea",
      refundReason: "Llegó dañado",
      lines: [line("p", 2, 1000, 300)],
    }),
    original,
    sale({ id: "v1", status: "voided", lines: [line("p", 1, 500, null)] }),
  ]);
  const rows = records(csv);
  assert.deepEqual(
    rows.map((row) => [row["ID de venta"], row["Tipo"], row["Estado"]]),
    [
      ["s1", "Venta", "Reembolsada"],
      ["r1", "Reembolso", "Reembolso"],
    ]
  );
  const refund = rows[1];
  assert.equal(refund["ID de venta original"], "s1");
  assert.equal(refund["Cantidad"], "-2");
  assert.equal(refund["Precio unitario (Bs)"], "10,00");
  assert.equal(refund["Subtotal (Bs)"], "-20,00");
  assert.equal(refund["Costo total (Bs)"], "-6,00");
  // Ana recorded the refund; it counts against Bea, who made the sale.
  assert.equal(refund["Registró"], "Ana");
  assert.equal(refund["Vendedor"], "Bea");
  assert.equal(refund["Motivo del reembolso"], "Llegó dañado");
  assert.equal(sum(rows, "Total neto (Bs)"), 0);
  assert.deepEqual(
    countExportedSales([
      original,
      { ...original, id: "v", status: "voided" },
      { ...original, id: "r", refundOfSaleId: "s1" },
    ]),
    { saleCount: 1, refundCount: 1 }
  );
});

test("a sale refunded after the range is still marked refunded", () => {
  const original = sale({ id: "s1", lines: [line("p", 1, 1000, 300)] });
  const laterRefund = sale({
    id: "r1",
    createdAt: "2026-10-02T15:00:00.000Z",
    status: "refunded",
    refundOfSaleId: "s1",
    lines: [line("p", 1, 1000, 300)],
  });
  // As the loaders build them: the refunded sale itself stays "completed".
  assert.equal(records(salesCsv([original]))[0]["Estado"], "Completada");
  assert.equal(
    records(
      salesCsv([original], {
        refundedSaleIds: refundedSaleIdsOf([original, laterRefund]),
      })
    )[0]["Estado"],
    "Reembolsada"
  );
  // Within the range, the refund record marks it by itself.
  assert.equal(
    records(salesCsv([original, laterRefund]))[0]["Estado"],
    "Reembolsada"
  );
});

test("rows are oldest first", () => {
  const rows = records(
    salesCsv([
      sale({
        id: "late",
        createdAt: "2026-09-26T20:00:00Z",
        lines: [line("p", 1, 100, 0)],
      }),
      sale({
        id: "early",
        createdAt: "2026-09-26T13:00:00Z",
        lines: [line("p", 1, 100, 0)],
      }),
    ])
  );
  assert.deepEqual(
    rows.map((row) => row["ID de venta"]),
    ["early", "late"]
  );
});

test("an empty range is the header alone", () => {
  assert.equal(salesCsv([]), `${UTF8_BOM}${SALES_CSV_HEADERS.join(";")}\r\n`);
});

test("the file builds in pieces that join to the whole", async () => {
  const sales = generateLedger();
  const chunks = [...salesCsvChunks(sales, { chunkSales: 7 })];
  assert.ok(chunks.length > 3);
  assert.equal(chunks.join(""), salesCsv(sales));

  let pauses = 0;
  const built = await buildSalesCsvChunks(sales, {
    pause: async () => {
      pauses += 1;
    },
  });
  assert.equal(built.join(""), salesCsv(sales));
  assert.equal(pauses, built.length);
});

test("the filename names the puesto and the range", () => {
  const month = resolveSalesRange("custom", "2026-09-01", "2026-09-30").bounds!;
  assert.equal(
    salesCsvFilename("Café Ñandú & Co.", month),
    "ventas-cafe-nandu-co-2026-09-01-a-2026-09-30.csv"
  );
  const day = resolveSalesRange("custom", "2026-09-26", "2026-09-26").bounds!;
  assert.equal(salesCsvFilename("", day), "ventas-puesto-2026-09-26.csv");
  assert.equal(filenameSlug("¡¡!!"), "puesto");
  assert.equal(filenameSlug("a".repeat(60)).length, 40);
});

test("the file is shared only from an iOS home screen app that can share it", () => {
  assert.equal(
    saveFileMethod({ iosStandalone: true, canShareFile: true }),
    "share"
  );
  assert.equal(
    saveFileMethod({ iosStandalone: true, canShareFile: false }),
    "download"
  );
  assert.equal(
    saveFileMethod({ iosStandalone: false, canShareFile: true }),
    "download"
  );
});

/**
 * 300 sales over September by three sellers, with voids, refunds (some
 * issued after the range), refunds of sales from before it, sale and line
 * discounts, missing costs and names that need quoting.
 */
function generateLedger(): Sale[] {
  // Park–Miller, as in sales-metrics.test.ts: the same case on every run.
  let seed = 11;
  const next = (max: number) => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed % max;
  };
  const sellers = ["ana", "bea", "ceci"];
  const products = [
    { id: "sticker", name: "Sticker", category: "Stickers" },
    { id: "print", name: 'Print "A4"; edición', category: "Prints" },
    { id: "mug", name: "=Taza\ngrande", category: "Cerámica" },
    { id: "pin", name: "Pin, esmaltado", category: "-Accesorios" },
  ];
  const start = Date.parse("2026-08-25T12:00:00Z");
  const generated: Sale[] = [];
  for (let index = 0; index < 300; index += 1) {
    const lines = products
      .filter(() => next(2) === 1)
      .map((product) => {
        const quantity = 1 + next(4);
        const unitPriceCents = 100 + next(5000);
        return line(
          product.id,
          quantity,
          unitPriceCents,
          next(5) === 0 ? null : next(unitPriceCents),
          next(3) === 0 ? next(unitPriceCents * quantity) : 0,
          product.name,
          product.category
        );
      });
    if (!lines.length) continue;
    const subtotal = lines.reduce(
      (total, item) => total + item.lineTotalCents,
      0
    );
    const seller = sellers[next(3)];
    const createdAt = new Date(
      start + index * 2.5 * 60 * 60 * 1000 + next(3_600_000)
    );
    const refunded = next(6) === 0;
    const original = sale({
      id: `g${index}`,
      userId: seller,
      userName: seller,
      createdAt: createdAt.toISOString(),
      paymentMethod: next(2) ? "cash" : "qr_transfer",
      saleDiscountCents: next(2) ? next(subtotal + 1) : 0,
      status: refunded ? "refunded" : next(10) === 0 ? "voided" : "completed",
      lines,
    });
    generated.push(original);
    if (refunded) {
      const recorder = sellers[next(3)];
      generated.push({
        ...original,
        id: `r${index}`,
        userId: recorder,
        userName: recorder,
        createdAt: new Date(
          createdAt.getTime() + next(5 * 86_400_000)
        ).toISOString(),
        refundOfSaleId: original.id,
        refundOfSaleUserId: original.userId,
        refundOfSaleUserName: original.userName,
        refundReason: next(2) ? "+Cambio de talla" : "",
      });
    }
  }
  return generated;
}

test("the export's totals equal the report's for the same range", () => {
  const ledger = generateLedger();
  const { bounds } = resolveSalesRange("custom", "2026-09-01", "2026-09-30");
  const inRange = filterSalesByBounds(ledger, bounds!);
  const metrics = computeMetrics(inRange);
  const rows = records(
    salesCsv(inRange, { refundedSaleIds: refundedSaleIdsOf(ledger) })
  );

  // The data set covers every case the export has to agree on.
  assert.ok(inRange.some((s) => s.status === "voided"));
  assert.ok(
    inRange.some(
      (s) => s.refundOfSaleId && !inRange.some((o) => o.id === s.refundOfSaleId)
    )
  );
  assert.ok(inRange.some((s) => s.saleDiscountCents > 0));
  assert.ok(metrics.hasUnknownCost);

  assert.equal(sum(rows, "Subtotal (Bs)"), metrics.grossCents);
  assert.equal(
    sum(rows, "Descuento de línea (Bs)") +
      sum(rows, "Descuento de venta prorrateado (Bs)"),
    metrics.discountCents
  );
  assert.equal(sum(rows, "Total neto (Bs)"), metrics.netRevenueCents);
  assert.equal(
    sum(rows, "Subtotal (Bs)") -
      sum(rows, "Descuento de línea (Bs)") -
      sum(rows, "Descuento de venta prorrateado (Bs)"),
    metrics.netRevenueCents
  );
  assert.equal(sum(rows, "Costo total (Bs)"), metrics.costCents);
  assert.equal(
    sum(rows, "Total neto (Bs)") - sum(rows, "Costo total (Bs)"),
    metrics.netEarningsCents
  );
  assert.equal(
    rows.some((row) => row["Costo unitario (Bs)"] === ""),
    metrics.hasUnknownCost
  );

  const refunds = rows.filter((row) => row["Tipo"] === "Reembolso");
  assert.equal(0 - sum(refunds, "Total neto (Bs)"), metrics.refundedCents);
  assert.equal(
    new Set(refunds.map((row) => row["ID de venta"])).size,
    metrics.refundCount
  );
  assert.equal(
    new Set(
      rows
        .filter((row) => row["Tipo"] === "Venta")
        .map((row) => row["ID de venta"])
    ).size,
    metrics.transactionCount
  );

  const unitsSold = computeProductTotals(inRange).reduce(
    (total, item) => total + item.quantity,
    0
  );
  assert.equal(
    rows.reduce((total, row) => total + Number(row["Cantidad"]), 0),
    unitsSold
  );

  // Every breakdown: grouping the rows gives Reports' rows.
  const groupBy = (column: string) => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(
        row[column],
        (totals.get(row[column]) ?? 0) + cents(row["Total neto (Bs)"])
      );
    }
    return totals;
  };
  const byMethod = groupBy("Método de pago");
  for (const item of computePaymentTotals(inRange)) {
    assert.equal(byMethod.get(item.label), item.total);
  }
  const byCategory = groupBy("Categoría");
  for (const item of computeCategoryTotals(inRange)) {
    assert.equal(byCategory.get(neutralizeFormula(item.category)), item.total);
  }
  const bySeller = groupBy("Vendedor");
  for (const item of computeUserTotals(inRange)) {
    assert.equal(bySeller.get(item.userName), item.total);
  }
});
