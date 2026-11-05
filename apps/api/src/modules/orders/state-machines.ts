import { AppError } from '../../lib/errors.js';

/**
 * The independent state machines around an order. Each lists the legal
 * transitions; anything else is rejected with 409 `invalid_transition`.
 * Diagrams: docs/ORDERS_AND_FULFILLMENT.md.
 */
export const MACHINES = {
  order: {
    pending_payment: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'completed', 'cancelled'],
    processing: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  },
  payment: {
    unpaid: ['pending', 'paid', 'failed'],
    pending: ['paid', 'failed'],
    failed: ['pending', 'paid'],
    paid: ['partially_refunded', 'refunded'],
    cod_pending: ['cod_collected'],
    cod_collected: ['partially_refunded', 'refunded'],
    partially_refunded: ['partially_refunded', 'refunded'],
    refunded: [],
  },
  fulfillment: {
    unfulfilled: ['packed', 'shipped', 'cancelled'],
    packed: ['shipped', 'cancelled'],
    shipped: ['delivered', 'delivery_failed', 'returned_to_origin'],
    delivery_failed: ['shipped', 'delivered', 'returned_to_origin'],
    delivered: [],
    returned_to_origin: [],
    cancelled: [],
  },
  pos_sync: {
    pending: ['in_progress', 'manual_required', 'synced'],
    in_progress: ['synced', 'failed', 'pending'],
    failed: ['pending', 'in_progress', 'manual_required', 'synced'],
    manual_required: ['pending', 'synced'],
    synced: [],
  },
  shipment: {
    pending: ['packed', 'shipped', 'cancelled'],
    packed: ['shipped', 'cancelled'],
    shipped: ['in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'rto_initiated'],
    in_transit: ['out_for_delivery', 'delivered', 'delivery_failed', 'rto_initiated'],
    out_for_delivery: ['in_transit', 'delivered', 'delivery_failed', 'rto_initiated'],
    delivery_failed: ['in_transit', 'out_for_delivery', 'delivered', 'rto_initiated'],
    rto_initiated: ['rto_delivered'],
    delivered: [],
    rto_delivered: [],
    cancelled: [],
  },
  return: {
    requested: ['approved', 'rejected', 'cancelled'],
    approved: ['received', 'cancelled'],
    received: ['completed'],
    rejected: [],
    completed: [],
    cancelled: [],
  },
  refund: {
    pending: ['processing', 'succeeded', 'failed'],
    processing: ['succeeded', 'failed'],
    failed: ['processing', 'succeeded'],
    succeeded: [],
  },
  transaction: {
    created: ['pending', 'succeeded', 'failed', 'cancelled'],
    pending: ['succeeded', 'failed', 'cancelled'],
    // A late success after a failure is accepted: the provider is the source of truth.
    failed: ['succeeded'],
    succeeded: [],
    cancelled: [],
  },
} as const;

export type MachineName = keyof typeof MACHINES;
export type StateOf<M extends MachineName> = keyof (typeof MACHINES)[M] & string;

export function canTransition<M extends MachineName>(machine: M, from: StateOf<M>, to: StateOf<M>): boolean {
  const table = MACHINES[machine] as Record<string, readonly string[]>;
  return table[from]?.includes(to) ?? false;
}

export function assertTransition<M extends MachineName>(machine: M, from: StateOf<M>, to: StateOf<M>): void {
  if (!canTransition(machine, from, to)) {
    throw new AppError(409, 'invalid_transition', `Cannot change ${machine.replace('_', ' ')} status from ${from} to ${to}.`, {
      machine,
      from,
      to,
    });
  }
}
