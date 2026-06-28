export type PaymentMethod = "cash" | "qr_transfer";
export type SaleStatus = "completed" | "voided" | "refunded";
export type CostStatus = "known" | "unknown";

export type Product = {
  id: string;
  name: string;
  priceCents: number;
  costCents: number | null;
  category: string;
  imagePath: string | null;
  imageUrl: string | null;
  imageTone: string;
  tracksInventory: boolean;
  lowStockThreshold: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductInput = {
  name: string;
  priceCents: number;
  costCents: number | null;
  category: string;
  imageTone?: string;
  imagePath?: string | null;
  tracksInventory?: boolean;
  lowStockThreshold?: number | null;
};

export type CartLine = {
  productId: string;
  quantity: number;
  lineDiscountCents?: number;
  lineDiscountReason?: string;
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
  lineDiscountReason?: string;
  lineTotalCents: number;
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
  clientCreatedAt?: string;
  voidedAt?: string;
  voidedByUserId?: string;
  refundOfSaleId?: string;
  refundedAt?: string;
  refundReason?: string;
};

export type ReportRange = "today" | "week" | "month" | "custom";

export type TenantMember = {
  id: string;
  userId: string;
  displayName: string;
  createdAt: string;
};

export type TenantSummary = {
  id: string;
  name: string;
};

export type TenantInvitation = {
  id: string;
  tenantId: string;
  token: string;
  createdByUserId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type ToastMessage = {
  id: string;
  text: string;
  tone: "success" | "info" | "danger";
};
