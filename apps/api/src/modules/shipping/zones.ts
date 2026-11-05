import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { shippingZones } from '../../db/schema.js';

export type ShippingZone = typeof shippingZones.$inferSelect;

/** The active zone whose longest PIN-code prefix matches, or null if the PIN is not serviceable. */
export async function findZone(db: DbOrTx, storeId: string, pincode: string): Promise<ShippingZone | null> {
  const zones = await db
    .select()
    .from(shippingZones)
    .where(and(eq(shippingZones.storeId, storeId), eq(shippingZones.isActive, true)));
  let best: { zone: ShippingZone; length: number } | null = null;
  for (const zone of zones) {
    for (const prefix of zone.pincodePrefixes) {
      if (pincode.startsWith(prefix) && (!best || prefix.length > best.length)) best = { zone, length: prefix.length };
    }
  }
  return best?.zone ?? null;
}

/** Flat-rate charge for a zone; free when the merchandise total reaches the zone's threshold. */
export function shippingCharge(zone: ShippingZone, merchandisePaise: number): number {
  if (zone.freeAbovePaise !== null && merchandisePaise >= zone.freeAbovePaise) return 0;
  return zone.chargePaise;
}
