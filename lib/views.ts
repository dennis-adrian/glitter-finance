export type View =
  | "sell"
  | "cart"
  | "checkout"
  | "saleComplete"
  | "sales"
  | "saleDetail"
  | "products"
  | "editor"
  | "reports"
  | "more"
  | "settings"
  | "diagnostics";

/** A screen plus its optional record id (sale id, product id). */
export type AppRoute = { view: View; id?: string };

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
      return "products";
    case "reports":
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
  const [head, id] = segments;

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
      return id === NEW_PRODUCT_SEGMENT
        ? { view: "editor" }
        : { view: "editor", id };
    case "reportes":
      return { view: "reports" };
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
    case "reports":
      return "#/reportes";
    case "more":
      return "#/mas";
    case "settings":
      return "#/ajustes";
    case "diagnostics":
      return "#/ajustes/diagnostico";
  }
}
