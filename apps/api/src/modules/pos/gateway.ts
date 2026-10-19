/**
 * Port for the existing POS, which stays authoritative for SKU identity and stock.
 *
 * Nothing here is implemented yet: the real POS API has not been inspected
 * (see docs/phase-0-discovery.md). Optional operations are only called when
 * `capabilities()` reports them, so no flow assumes the POS supports
 * reservations, order ingestion or cancellation.
 */

export type PosSku = {
  /** The POS's own SKU code; e-commerce never mints these. */
  skuCode: string;
  barcode?: string;
  name: string;
  /** POS-side grouping of variants, when the POS has one. */
  productRef?: string;
  attributes?: Record<string, string>;
};

export type PosStockLevel = {
  skuCode: string;
  /** Sellable quantity as reported by the POS. */
  available: number;
  /** When the POS computed this figure, if it says. */
  asOf?: Date;
  /** POS location (branch/warehouse) if stock is per location. */
  locationRef?: string;
};

export type PosOrderLine = { skuCode: string; quantity: number; unitPricePaise: number };

export type PosOrder = {
  /** Idempotency key: the e-commerce order number. Retries must reuse it. */
  externalOrderNumber: string;
  lines: PosOrderLine[];
  paymentMode: 'prepaid' | 'cod';
};

export type PosCapabilities = {
  listSkus: boolean;
  getStock: boolean;
  submitOrder: boolean;
  reserveStock: boolean;
  cancelOrder: boolean;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export interface PosGateway {
  capabilities(): PosCapabilities;
  listSkus(cursor: string | null): Promise<Page<PosSku>>;
  getStock(skuCodes: string[]): Promise<PosStockLevel[]>;
  submitOrder?(order: PosOrder): Promise<{ posOrderRef: string }>;
  reserveStock?(externalOrderNumber: string, lines: PosOrderLine[], ttlSeconds: number): Promise<{ reservationRef: string }>;
  releaseReservation?(reservationRef: string): Promise<void>;
  cancelOrder?(posOrderRef: string): Promise<void>;
}

/** Thrown for any POS failure; `retryable` drives the job retry policy. */
export class PosError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PosError';
  }
}
