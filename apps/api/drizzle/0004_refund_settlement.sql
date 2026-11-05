ALTER TABLE "refunds" ADD COLUMN "settlement_source" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settled_by_type" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settled_by_id" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settlement_reference" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settlement_note" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_settlement_source_ck" CHECK ("refunds"."settlement_source" is null or "refunds"."settlement_source" in ('provider', 'manual'));