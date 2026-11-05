import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { orderEvents, orderItems, orders, returnRequests, shipments } from '../../db/schema.js';
import { cancelRefundPaise, customerCanCancel } from './eligibility.js';
import { customerCanReturn, loadDeliveredAt, returnWindowEndsAt } from './returns.js';

type Order = typeof orders.$inferSelect;

/** Customer-facing order view: no idempotency data, internal notes or POS references. `now` is the app clock. */
export async function presentOrder(db: DbOrTx, order: Order, now: Date = new Date()) {
  const [items, events, shipmentRows, returnRows, deliveredAt] = await Promise.all([
    db.select().from(orderItems).where(and(eq(orderItems.storeId, order.storeId), eq(orderItems.orderId, order.id))).orderBy(asc(orderItems.createdAt)),
    db
      .select({ machine: orderEvents.machine, toState: orderEvents.toState, note: orderEvents.note, createdAt: orderEvents.createdAt })
      .from(orderEvents)
      .where(and(eq(orderEvents.storeId, order.storeId), eq(orderEvents.orderId, order.id), eq(orderEvents.isPublic, true)))
      .orderBy(asc(orderEvents.createdAt)),
    db
      .select({ id: shipments.id, status: shipments.status, courier: shipments.courier, trackingNumber: shipments.trackingNumber, trackingUrl: shipments.trackingUrl })
      .from(shipments)
      .where(and(eq(shipments.storeId, order.storeId), eq(shipments.orderId, order.id))),
    db
      .select({ id: returnRequests.id, type: returnRequests.type, status: returnRequests.status, createdAt: returnRequests.createdAt, items: returnRequests.items })
      .from(returnRequests)
      .where(and(eq(returnRequests.storeId, order.storeId), eq(returnRequests.orderId, order.id))),
    loadDeliveredAt(db, order),
  ]);
  const open = returnRows.filter((r) => !['rejected', 'cancelled'].includes(r.status));
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    subtotalPaise: order.subtotalPaise,
    discountPaise: order.discountPaise,
    shippingPaise: order.shippingPaise,
    codFeePaise: order.codFeePaise,
    taxPaise: order.taxPaise,
    totalPaise: order.totalPaise,
    refundedPaise: order.refundedPaise,
    shippingAddress: order.shippingAddress,
    appliedPromotions: order.appliedPromotions.map(({ name, couponCode, discountPaise, shippingDiscountPaise }) => ({ name, couponCode, discountPaise, shippingDiscountPaise })),
    placedAt: order.placedAt,
    items: items.map((i) => ({
      id: i.id,
      productTitle: i.productTitle,
      variantTitle: i.variantTitle,
      skuCode: i.skuCode,
      options: i.options,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      mrpPaise: i.mrpPaise,
      unitPricePaise: i.unitPricePaise,
      discountPaise: i.discountPaise,
      taxPaise: i.taxPaise,
      lineTotalPaise: i.lineTotalPaise,
    })),
    timeline: events,
    shipments: shipmentRows,
    returns: returnRows.map(({ id, type, status, createdAt }) => ({ id, type, status, createdAt })),
    // What the customer may do right now, decided by the server (the endpoints re-check on every call).
    actions: {
      canCancel: customerCanCancel(order),
      // What cancelling would refund right now (null when it cannot be cancelled or nothing was collected).
      cancelRefund: customerCanCancel(order) && cancelRefundPaise(order) > 0 ? { amountPaise: cancelRefundPaise(order) } : null,
      canReturn: customerCanReturn({ deliveredAt, now, lines: items.map((i) => ({ id: i.id, quantity: i.quantity })), open }),
      returnWindowEndsAt: deliveredAt ? returnWindowEndsAt(deliveredAt) : null,
    },
  };
}
