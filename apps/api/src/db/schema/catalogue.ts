import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, type SeoMeta, timestamps } from './common.js';
import { stores } from './tenancy.js';

// Every catalogue table carries store_id, and child tables reference their
// parent through (store_id, id) so a row can never point at another store's data.

export const attributeType = pgEnum('attribute_type', ['text', 'number', 'boolean', 'select']);
export const attributeScope = pgEnum('attribute_scope', ['product', 'variant']);

/** Store-defined attributes (e.g. fabric, size, colour). Values live on products/variants as JSON. */
export const attributeDefinitions = pgTable(
  'attribute_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    type: attributeType('type').notNull(),
    scope: attributeScope('scope').notNull(),
    // Allowed values for `select` attributes.
    options: jsonb('options').$type<string[]>().notNull().default([]),
    isFilterable: boolean('is_filterable').notNull().default(false),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('attribute_definitions_store_code_uq').on(t.storeId, t.code)],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    seo: jsonb('seo').$type<SeoMeta>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('categories_store_slug_uq').on(t.storeId, t.slug),
    unique('categories_store_id_uq').on(t.storeId, t.id),
    index('categories_parent_idx').on(t.parentId),
    foreignKey({
      name: 'categories_parent_fk',
      columns: [t.storeId, t.parentId],
      foreignColumns: [t.storeId, t.id],
    }),
  ],
);

export type SizeChart = { columns: string[]; rows: string[][]; unit?: string };

export const sizeCharts = pgTable(
  'size_charts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    chart: jsonb('chart').$type<SizeChart>().notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [unique('size_charts_store_id_uq').on(t.storeId, t.id)],
);

export const productStatus = pgEnum('product_status', ['draft', 'published', 'archived']);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    // Free-form label/value list, e.g. [{ label: 'Wash care', value: 'Hand wash' }].
    specifications: jsonb('specifications').$type<{ label: string; value: string }[]>().notNull().default([]),
    // Values for product-scope attribute definitions, keyed by attribute code.
    attributes: jsonb('attributes').$type<Record<string, string | number | boolean>>().notNull().default({}),
    status: productStatus('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // GST rate in basis points (500 = 5%). Prices are GST-inclusive.
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    hsnCode: text('hsn_code'),
    sizeChartId: uuid('size_chart_id'),
    seo: jsonb('seo').$type<SeoMeta>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('products_store_slug_uq').on(t.storeId, t.slug),
    unique('products_store_id_uq').on(t.storeId, t.id),
    index('products_store_status_idx').on(t.storeId, t.status),
    foreignKey({
      name: 'products_size_chart_fk',
      columns: [t.storeId, t.sizeChartId],
      foreignColumns: [sizeCharts.storeId, sizeCharts.id],
    }),
    check('products_tax_rate_ck', sql`${t.taxRateBps} between 0 and 10000`),
  ],
);

export const variantStatus = pgEnum('variant_status', ['active', 'inactive']);

/**
 * A sellable variant. `sku_code` is the POS's SKU identity: e-commerce maps to
 * it and never mints SKUs of its own.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    productId: uuid('product_id').notNull(),
    skuCode: text('sku_code').notNull(),
    title: text('title').notNull(),
    // Values for variant-scope attributes, e.g. { size: 'M', colour: 'Indigo' }.
    options: jsonb('options').$type<Record<string, string>>().notNull().default({}),
    status: variantStatus('status').notNull().default('active'),
    position: integer('position').notNull().default(0),
    weightGrams: integer('weight_grams'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('product_variants_store_sku_uq').on(t.storeId, t.skuCode),
    unique('product_variants_store_id_uq').on(t.storeId, t.id),
    index('product_variants_product_idx').on(t.productId),
    foreignKey({
      name: 'product_variants_product_fk',
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete('cascade'),
  ],
);

export const productCategories = pgTable(
  'product_categories',
  {
    storeId: uuid('store_id').notNull(),
    productId: uuid('product_id').notNull(),
    categoryId: uuid('category_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    index('product_categories_category_idx').on(t.categoryId),
    foreignKey({
      name: 'product_categories_product_fk',
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'product_categories_category_fk',
      columns: [t.storeId, t.categoryId],
      foreignColumns: [categories.storeId, categories.id],
    }).onDelete('cascade'),
  ],
);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    seo: jsonb('seo').$type<SeoMeta>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('collections_store_slug_uq').on(t.storeId, t.slug),
    unique('collections_store_id_uq').on(t.storeId, t.id),
  ],
);

export const collectionProducts = pgTable(
  'collection_products',
  {
    storeId: uuid('store_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    productId: uuid('product_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.productId] }),
    index('collection_products_product_idx').on(t.productId),
    foreignKey({
      name: 'collection_products_collection_fk',
      columns: [t.storeId, t.collectionId],
      foreignColumns: [collections.storeId, collections.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'collection_products_product_fk',
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete('cascade'),
  ],
);

export const mediaKind = pgEnum('media_kind', ['image', 'video']);

/** Metadata for media hosted elsewhere (object storage/CDN). Files are not stored in the database. */
export const productMedia = pgTable(
  'product_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    kind: mediaKind('kind').notNull().default('image'),
    url: text('url').notNull(),
    altText: text('alt_text'),
    width: integer('width'),
    height: integer('height'),
    position: integer('position').notNull().default(0),
    createdAt,
  },
  (t) => [
    index('product_media_product_idx').on(t.productId, t.position),
    foreignKey({
      name: 'product_media_product_fk',
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'product_media_variant_fk',
      columns: [t.storeId, t.variantId],
      foreignColumns: [productVariants.storeId, productVariants.id],
    }).onDelete('cascade'),
  ],
);
