import { type Page, type PosCapabilities, PosError, type PosGateway, type PosSku, type PosStockLevel } from './gateway.js';

/**
 * The gateway used while no POS adapter exists (POS_ADAPTER=none). It reports
 * no capabilities, so stock sync is skipped and orders are marked
 * `manual_required` for POS entry. Checkout relies on the stock read model only.
 */
export class UnconfiguredPosGateway implements PosGateway {
  capabilities(): PosCapabilities {
    return { listSkus: false, getStock: false, submitOrder: false, reserveStock: false, cancelOrder: false };
  }
  async listSkus(): Promise<Page<PosSku>> {
    throw new PosError('No POS adapter is configured', false);
  }
  async getStock(): Promise<PosStockLevel[]> {
    throw new PosError('No POS adapter is configured', false);
  }
}
