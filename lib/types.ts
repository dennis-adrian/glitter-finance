export type PaymentMethod = "cash" | "qr_transfer";
export type SaleStatus = "completed" | "voided" | "refunded";
export type CostStatus = "known" | "unknown";

export type Product = {
  id: string;
  name: string;
  priceCents: number;
  costCents: number | null;
  category: string;
  imageTone: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CartLine = {
  productId: string;
  quantity: number;
};

export type SaleLine = {
  id: string;
  productId: string;
  productName: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number | null;
  lineDiscountCents: number;
};

export type Sale = {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  createdAt: string;
  paymentMethod: PaymentMethod;
  saleDiscountCents: number;
  saleDiscountReason?: string;
  lines: SaleLine[];
  status: SaleStatus;
  voidedAt?: string;
  refundOfSaleId?: string;
  refundedAt?: string;
};

export type ReportRange = "today" | "week" | "month";

export type ToastMessage = {
  id: string;
  text: string;
  tone: "success" | "info" | "danger";
};
