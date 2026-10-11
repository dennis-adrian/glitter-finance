export type View =
  | "sell"
  | "cart"
  | "checkout"
  | "saleComplete"
  | "sales"
  | "saleDetail"
  | "products"
  | "editor"
  | "categories"
  | "reports"
  | "sellerSales"
  | "sellerSaleDetail"
  | "more"
  | "settings"
  | "diagnostics";

/**
 * A screen, the record it shows (`id`: sale id, product id) and, on a
 * seller's sales, whose they are (`sellerId`: their user id).
 */
export type AppRoute = { view: View; id?: string; sellerId?: string };

/** Destinations shown in the bottom nav, rail, and sidebar. */
export type PrimaryView = "sell" | "sales" | "products" | "reports" | "more";

export function primaryViewFor(view: View): PrimaryView {
  switch (view) {
    case "sell":
    case "cart":
    case "checkout":
    case "saleComplete":
      return "sell";
    case "sales":
    case "saleDetail":
      return "sales";
    case "products":
    case "editor":
    case "categories":
      return "products";
    case "reports":
    case "sellerSales":
    case "sellerSaleDetail":
      return "reports";
    case "more":
    case "settings":
    case "diagnostics":
      return "more";
  }
}

/** Top-level screens keep the bottom nav visible on phones. */
export function isPrimaryView(view: View) {
  return (
    view === "sell" ||
    view === "cart" ||
    view === "sales" ||
    view === "products" ||
    view === "reports" ||
    view === "more"
  );
}

// Routes live in the URL hash (`/#/ventas/<id>`) so the document URL stays
// `/`: the service worker caches one navigation entry and offline reloads of
// any screen still resolve.
const NEW_PRODUCT_SEGMENT = "nuevo";
// Product and user ids are UUIDs, so these fixed segments can't collide
// with them.
const CATEGORIES_SEGMENT = "categorias";
const SELLER_SEGMENT = "vendedor";

export function parseRouteHash(hash: string): AppRoute {
  const segments = hash
    .replace(/^#/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const [head, id, sellerId, saleId] = segments;

  switch (head) {
    case undefined:
      return { view: "sell" };
    case "pedido":
      return { view: "cart" };
    case "cobrar":
      return { view: "checkout" };
    case "cobrado":
      return { view: "saleComplete" };
    case "ventas":
      return id ? { view: "saleDetail", id } : { view: "sales" };
    case "catalogo":
      if (!id) return { view: "products" };
      if (id === CATEGORIES_SEGMENT) return { view: "categories" };
      return id === NEW_PRODUCT_SEGMENT
        ? { view: "editor" }
        : { view: "editor", id };
    case "reportes":
      // `#/reportes/vendedor/<userId>[/<saleId>]`: a seller's sales.
      if (id !== SELLER_SEGMENT || !sellerId) return { view: "reports" };
      return saleId
        ? { view: "sellerSaleDetail", sellerId, id: saleId }
        : { view: "sellerSales", sellerId };
    case "mas":
      return { view: "more" };
    case "ajustes":
      return id === "diagnostico"
        ? { view: "diagnostics" }
        : { view: "settings" };
    default:
      return { view: "sell" };
  }
}

export function formatRouteHash(route: AppRoute): string {
  const id = route.id ? encodeURIComponent(route.id) : null;

  switch (route.view) {
    case "sell":
      return "";
    case "cart":
      return "#/pedido";
    case "checkout":
      return "#/cobrar";
    case "saleComplete":
      return "#/cobrado";
    case "sales":
      return "#/ventas";
    case "saleDetail":
      return id ? `#/ventas/${id}` : "#/ventas";
    case "products":
      return "#/catalogo";
    case "editor":
      return `#/catalogo/${id ?? NEW_PRODUCT_SEGMENT}`;
    case "categories":
      return `#/catalogo/${CATEGORIES_SEGMENT}`;
    case "reports":
      return "#/reportes";
    case "sellerSales":
    case "sellerSaleDetail": {
      if (!route.sellerId) return "#/reportes";
      const sellerHash = `#/reportes/${SELLER_SEGMENT}/${encodeURIComponent(route.sellerId)}`;
      return route.view === "sellerSaleDetail" && id
        ? `${sellerHash}/${id}`
        : sellerHash;
    }
    case "more":
      return "#/mas";
    case "settings":
      return "#/ajustes";
    case "diagnostics":
      return "#/ajustes/diagnostico";
  }
}
