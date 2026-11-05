-- Order line snapshots are immutable once written. Corrections are made with
-- new records (refunds, returns, timeline events), never by editing history.
CREATE FUNCTION reject_order_item_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order_items rows are immutable (% attempted)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER order_items_immutable
  BEFORE UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION reject_order_item_change();
--> statement-breakpoint
-- The order-level snapshots and money columns are fixed at creation too.
CREATE FUNCTION reject_order_snapshot_change() RETURNS trigger AS $$
BEGIN
  IF NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot
     OR NEW.shipping_address IS DISTINCT FROM OLD.shipping_address
     OR NEW.applied_promotions IS DISTINCT FROM OLD.applied_promotions
     OR NEW.subtotal_paise IS DISTINCT FROM OLD.subtotal_paise
     OR NEW.discount_paise IS DISTINCT FROM OLD.discount_paise
     OR NEW.shipping_paise IS DISTINCT FROM OLD.shipping_paise
     OR NEW.cod_fee_paise IS DISTINCT FROM OLD.cod_fee_paise
     OR NEW.tax_paise IS DISTINCT FROM OLD.tax_paise
     OR NEW.total_paise IS DISTINCT FROM OLD.total_paise
     OR NEW.order_number IS DISTINCT FROM OLD.order_number
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'order snapshot columns are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER orders_snapshot_immutable
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION reject_order_snapshot_change();
