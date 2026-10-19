import {
  type Page,
  type PosCapabilities,
  PosError,
  type PosGateway,
  type PosOrder,
  type PosSku,
  type PosStockLevel,
} from '../../src/modules/pos/gateway.js';

/**
 * TEST DOUBLE. Models a POS that supports stock reads and order submission so
 * the integration flow (jobs, retries, idempotency, recovery) can be tested.
 * It says nothing about what the real POS supports; that is still unverified.
 */
export class InMemoryPosGateway implements PosGateway {
  stock = new Map<string, number>();
  submitted = new Map<string, PosOrder>();
  /** Number of upcoming calls that fail, and whether those failures are retryable. */
  failNext = 0;
  failRetryable = true;
  caps: PosCapabilities = { listSkus: true, getStock: true, submitOrder: true, reserveStock: false, cancelOrder: false };

  capabilities(): PosCapabilities {
    return this.caps;
  }

  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new PosError('Simulated POS failure', this.failRetryable);
    }
  }

  async listSkus(): Promise<Page<PosSku>> {
    this.maybeFail();
    return { items: [...this.stock.keys()].map((skuCode) => ({ skuCode, name: skuCode })), nextCursor: null };
  }

  async getStock(skuCodes: string[]): Promise<PosStockLevel[]> {
    this.maybeFail();
    return skuCodes.filter((s) => this.stock.has(s)).map((skuCode) => ({ skuCode, available: this.stock.get(skuCode)! }));
  }

  async submitOrder(order: PosOrder): Promise<{ posOrderRef: string }> {
    this.maybeFail();
    // Idempotent by external order number, as a real adapter must be.
    if (!this.submitted.has(order.externalOrderNumber)) this.submitted.set(order.externalOrderNumber, order);
    return { posOrderRef: `POS-${order.externalOrderNumber}` };
  }
}
