/**
 * Port for a courier/aggregator integration (shipment booking, tracking).
 *
 * No adapter exists: no courier has been chosen or approved. Until one is,
 * shipments and tracking events are recorded manually through the admin API.
 */
export type CourierTrackingEvent = {
  externalEventId: string;
  status:
    | 'shipped'
    | 'in_transit'
    | 'out_for_delivery'
    | 'delivered'
    | 'delivery_failed'
    | 'rto_initiated'
    | 'rto_delivered';
  description?: string;
  location?: string;
  occurredAt: Date;
};

export interface CourierAdapter {
  readonly name: string;
  createShipment(input: {
    shipmentId: string;
    orderNumber: string;
    pincode: string;
    weightGrams: number;
    cod: boolean;
    codAmountPaise: number;
  }): Promise<{ trackingNumber: string; trackingUrl?: string }>;
  fetchTracking(trackingNumber: string): Promise<CourierTrackingEvent[]>;
}
