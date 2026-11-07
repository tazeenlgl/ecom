# Product data model

Status: **proposal, nothing implemented.** Baseline: `apps/api/src/db/schema/catalogue.ts` at `main` `e03b827`. Migrations `0000`-`0004` exist; every change below is a new additive migration starting at `0005`, reviewed as SQL before merge. Nothing here was run against any database.

## 1. Existing model (verified)

| Table | Relevant columns / constraints |
| --- | --- |
| `attribute_definitions` | `code` (unique per store), `label`, `type` (text/number/boolean/select), `scope` (product/variant), `options text[]`-as-jsonb `string[]`, `is_filterable`, `position`. **No** required flag, group, unit, help text, or product-type link |
| `products` | `slug` (unique per store), `title`, `description`, `specifications` jsonb `{label,value}[]`, `attributes` jsonb `Record<code, string\|number\|boolean>`, `status` draft/published/archived, `published_at`, `tax_rate_bps` (0-10000), `hsn_code`, `size_chart_id` (store-scoped FK), `seo` jsonb `{title, description, canonicalUrl, noIndex}`. **No** type, tags, version, variant axes, content-field state |
| `product_variants` | `sku_code` (unique per store; POS identity), `title`, `options` jsonb `Record<code,string>`, `status`, `position`, `weight_grams` |
| `variant_prices` / `price_history` | One current price per variant (`mrp_paise`, `pricePaise`, `updated_by`) and an append-only history written by the price route |
| `product_categories`, `collection_products` | Store-scoped composite FKs, so cross-store links are impossible |
| `size_charts` | `name`, `chart` jsonb `{columns, rows, unit?}`, `notes` |
| `product_media` | `kind` image/video, `url` (https, ≤1000), `alt_text`, `width`, `height`, `position`, optional `variant_id`. **No** storage key, MIME type, byte size, checksum, status, featured flag, or source |
| Pattern | Child tables reference parents by `(store_id, id)`; `store_id` on every table; `timestamps` helper (`created_at`, `updated_at` with `$onUpdate`) |

Validation today: `validateAttributes` checks that submitted codes exist for the scope and match type/options. It does **not** check required attributes, and nothing prevents stored values from becoming invalid when an option is later removed from a definition.

## 2. Decisions

### D1. Product types: **yes, a new store-scoped entity**

A product type is a named template ("Kurta set", "Footwear", "Accessory") that selects which existing attribute definitions apply and how the editor presents them. Reasons: (a) definitions are store-wide and must stay reusable across types, so requirement, order and grouping are properties of the *pairing*, not of the definition; (b) a type carries defaults (size chart, GST, description template) that no existing column holds; (c) it keeps apparel concepts in data, not code. `products.product_type_id` is **nullable** so every existing product and the current API keep working untyped.

```
product_types
  id uuid pk, store_id fk stores, code text (unique per store), name text,
  description text null, default_size_chart_id uuid null (store-scoped fk),
  default_tax_rate_bps int null, default_hsn_code text null,
  default_description_template_id uuid null (store-scoped fk),
  expects_size_chart boolean default false, is_active boolean default true,
  position int default 0, created_at, updated_at
  unique (store_id, code), unique (store_id, id)

product_type_attributes            -- the template: type <-> definition
  store_id, product_type_id, attribute_id (all composite fks),
  is_required boolean default false, position int, group_id uuid null,
  is_variant_axis boolean default false   -- only meaningful for scope 'variant'
  primary key (product_type_id, attribute_id)

attribute_groups                   -- ordering/grouping of the form
  id, store_id, code, label, position; unique (store_id, code)
```

Ordering is `position` on the template row; groups are optional labels ("Fabric & care", "Fit"). An attribute not in a product's type can still be set from the "extra attributes" picker (existing behaviour preserved).

### D2. Required fields and ordering

Stored on `product_type_attributes` (`is_required`, `position`, `group_id`). Enforcement: the **publish route** (and `GET .../readiness`) rejects a typed product missing required attributes; **drafts may be incomplete** so staff can save work in progress. `PATCH` still validates type/options of whatever is supplied. Required status is evaluated against the product's *current* type; changing type shows a diff of attributes that will become unused (values are kept, hidden, never deleted).

### D3. Attribute definition extensions (additive columns)

`description text null`, `unit text null` (e.g. "cm"), `help_text text null`, `is_archived boolean default false`. Options stay `string[]` for now. Risk: renaming an option orphans stored values; mitigation is a server-side `rename option` operation that rewrites matching product/variant values in one transaction with an audit row (planned, Phase 2). A move to `{value,label}` options is deferred (open decision) because it touches storefront rendering and filters.

### D4. Variant options and POS SKU mapping

Variant axes are variant-scope attribute codes, kept per product in `products.variant_axes text[] default '{}'` (additive). The editor builds the cartesian product of the chosen axes' values as **grid rows that exist only in the browser** until mapped. A row becomes a `product_variants` row only when the admin supplies a POS SKU code (`sku_code`, existing unique per store; validated by pattern today). Consequences: no SKU is ever minted (CLAUDE.md rule 1); unmapped combinations are listed in readiness as "not sellable"; stock is looked up by `sku_code` as today. If `PosGateway.capabilities().listSkus` becomes true, the editor may offer a picker, but today only `UnconfiguredPosGateway` and a test double exist, so manual entry is the only path. A new constraint `unique (product_id, options)` (partial, active variants) prevents duplicate combinations; it needs a data check before the migration because existing rows may already collide.

### D5. Tags

```
product_tags: store_id, product_id, tag text (lower-case, 1-40 chars)
  primary key (product_id, tag), fk (store_id, product_id)
  index (store_id, tag)
```
A separate table (not a jsonb array) so storefront filtering and counts stay indexable. Tags never feed SEO keywords (no meta-keywords feature).

### D6. Generation mode and manual overrides

Canonical text stays in the existing columns (`products.description`, `products.seo.*`, `products.slug`, `product_media.alt_text`). State is separate so existing readers are untouched:

```
content_field_states
  id, store_id, entity_type ('product'|'media'|'category'|'collection'),
  entity_id uuid, field text ('description'|'seo.title'|'seo.description'|'slug'|'alt_text'|
        'og.title'|'og.description'|'og.image'),
  mode ('auto'|'manual') default 'manual',
  status ('empty'|'generated'|'edited'|'stale'|'failed'|'insufficient_data'),
  value_hash text null,        -- hash of the value last written by the generator
  source_hash text null,       -- hash of the verified facts used
  generator text null, generated_at, last_error text null, updated_at
  unique (store_id, entity_type, entity_id, field)

content_suggestions
  id, store_id, entity_type, entity_id, field, proposed_value text,
  base_value_hash text null,   -- the value this suggestion would replace
  source_hash text, facts jsonb, generator text,
  status ('pending'|'applied'|'discarded'|'expired') default 'pending',
  created_by, created_at, decided_by null, decided_at null
```
Default for all existing rows is **manual** (no row = manual, status derived), so migration cannot alter any existing content. Rules are in [SEO_AND_CONTENT_GENERATION.md](SEO_AND_CONTENT_GENERATION.md).

### D7. SEO metadata shape

`SeoMeta` (`common.ts:14`) is `{title?, description?, canonicalUrl?, noIndex?}` and is used by products, categories and collections. Extend the type (jsonb, no migration needed for the column) with optional `ogTitle`, `ogDescription`, `ogImageMediaId`, `twitterCard` (`summary`|`summary_large_image`). `seoSchema` in `lib/route.ts` gains the same optional fields. `ogImageMediaId` is a media row id of the same product (validated), not a URL, so a deleted image cannot leave a dangling external URL. No keywords field.

### D8. Optimistic locking

**Superseded by section 5.4** (second review): `expectedVersion` is **required**, versions exist on products and variants, and the compare-and-set rules and error codes are defined there. Original text, kept for history: `products.version int not null default 1`, incremented by every product write.

### D9. Slug history

`slug_redirects (store_id, entity_type, from_slug, entity_id, created_at)`, unique `(store_id, entity_type, from_slug)`. Written when a **published** product's slug changes; the storefront product route looks up a miss in this table and answers a 301 target. Auto slug generation applies only while a product has never been published.

### D10. Media

Columns and the `media_uploads` staging table are specified in [MEDIA_ARCHITECTURE.md](MEDIA_ARCHITECTURE.md). Featured image is **position 0** among non-variant images plus an explicit `is_featured` boolean to avoid depending on array order alone.

### D11. Description templates

`content_templates (id, store_id, code, name, kind 'description', body text, is_active)` with placeholders resolved only from verified facts; unknown placeholders are rejected at save, and a placeholder whose fact is missing is omitted with its surrounding clause, never filled with a guess.

## 3. Migration plan

| Migration | Contents | Risk |
| --- | --- | --- |
| `0005_product_versioning` | `products.version`; `slug_redirects` | Low: nullable/defaulted additions |
| `0006_product_types` | `product_types`, `product_type_attributes`, `attribute_groups`, `products.product_type_id`, `products.variant_axes`, definition columns, `product_tags` | Low-medium: new FKs; no backfill |
| `0007_content_state` | `content_field_states`, `content_suggestions`, `content_templates` | Low |
| `0008_media_pipeline` | `product_media` columns, `media_uploads` | Medium: depends on the approved storage design |
| `0009_variant_uniqueness` | partial unique index on active variant option sets | Medium: **pre-check for existing duplicates**, fail with a report rather than delete data |

Each migration: additive only, idempotent re-run test (apply twice on a disposable DB, as done for `0004`), a populated-copy test, no data rewrite, and a documented rollback ("previous image ignores new objects"; dropping new objects is a separate, approved operation after the previous release is retired). `docs/MIGRATIONS.md`, `docs/DATABASE.md`, `docs/ER_DIAGRAM.md` are updated in the same change.

## 4. Open data-model questions

1. `{value,label}` select options now or later (D3).
2. Whether product types may be changed after publish (proposed: yes, with a diff and no value deletion).
3. Whether `unique (product_id, options)` can be enforced on existing data (needs a read-only check on a copy).
4. Whether collections/categories also get generation state (the table supports it; the first release covers products and product media only).

## 5. Second-review refinements

### 5.1 Store scoping (confirmed)

`product_types`, `product_type_attributes`, `attribute_groups`, `content_*` and `product_tags` all carry `store_id`; every cross-table reference is a composite `(store_id, id)` foreign key, as in `catalogue.ts` today, so a type can reference only that store's definitions, groups, size charts and templates, and a product can reference only its own store's type. There is no platform-wide template in this release. A platform-level "starter pack" (apparel, accessories) is a copy-on-create script owned by the platform admin, never a shared row; this keeps brands independent and avoids a cross-tenant table.

### 5.2 Works for clothing and unrelated categories

The core model contains no apparel noun. Illustrations (data, not code): a *Garment* type uses select `size`/`colour` as variant axes and text `fabric`, `fit`; a *Jewellery* type uses variant axis `metal`, number `weight_g` with unit, boolean `hallmarked`; a *Home decor* type uses no variant axis (single default variant), select `material`, number `height_cm`. Rules that make this safe:

* **Products without options** get one variant (title = product title, `options = {}`), mapped to a POS SKU as always; the editor creates the form row, the API does not invent a SKU.
* Axes are per type but chosen per product (`variant_axes`), may be empty, and may be any variant-scope definition.
* Attribute `unit` and number `min`/`max` live on the definition (`constraints jsonb`, additive: `{min?, max?, maxLength?, step?}`); the type template cannot loosen a definition's own constraints.
* Filterable flags and groups are data; no code path switches on a code like `size`.

### 5.3 Validation, ordering, grouping, required behaviour

| Aspect | Rule |
| --- | --- |
| Value validation | On every write of `attributes` / variant `options`: code exists in the store for that scope, type matches, select value in `options`, number within `constraints`, text within `maxLength`. Unknown codes are rejected (unchanged) |
| Required | Property of `product_type_attributes.is_required`. **Draft saves never fail on a missing required value; publish does.** Checked for the product's current type |
| Required variant attributes | A template row with scope `variant` and `is_required` must have a value on **every active variant** at publish |
| Order | `product_type_attributes.position` ascending, ties by `attribute_definitions.position`, then label |
| Grouping | Optional `group_id`; ungrouped attributes render in an "Other" group last; groups ordered by `attribute_groups.position` |
| Attribute not in template | Allowed through "extra attributes"; shown in a separate section |
| Definition changes after use | Removing a select option that is in use is refused with a usage list unless replaced via the rename/merge operation; deleting a definition in use is refused; archiving hides it from pickers but keeps values |
| Type change on a product | Values are kept, never deleted; values outside the new template move to "extra attributes"; required-ness re-evaluated at publish |
| Existing data | `product_type_id` null; no backfill; existing `attributes`, `options`, `specifications` untouched; a read-only report lists existing values that violate their definition (for admin clean-up, not auto-fixed) |
| Default type | Optional per store; applied only to new products |

### 5.4 Versioning (replaces D8; `expectedVersion` is required)

* `products.version int not null default 1` and `product_variants.version int not null default 1` (variant fields and its price; so a price change by one person does not conflict with a content edit by another, and vice versa).
* **Product version covers**: product row, categories, collections, tags, media list (add/delete/reorder/alt), content-field state changes and suggestion apply. **Variant version covers**: variant row and its price.
* Every mutating admin route on those objects requires `expectedVersion` (body) and increments the version in the same statement: `UPDATE ... SET version = version + 1 ... WHERE store_id = $s AND id = $id AND version = $expected RETURNING *`. Zero rows are followed by a lookup: missing → 404, otherwise 409 `stale_version` with the current version and `updatedAt/updatedBy`. This is a compare-and-set, so two concurrent writers cannot both succeed, without a long transaction or row lock held across HTTP calls.
* Creation returns `version: 1`. Status changes (publish/unpublish/archive) also require and bump it.
* **Why required, not optional:** the admin UI is the only client of these routes (`CLAUDE.md`: web and admin never decide authorization; the admin uses `/v1/admin/*` only) and ships in the same repository; an optional field means a missed call site silently reverts to last-write-wins, which is exactly the failure to prevent. The transition cost is a one-time failure for a stale cached admin page, answered by 428 `version_required` and a reload prompt. If an external API consumer is ever discovered, a deprecation window can be added then.
* Error codes `stale_version` (409), `version_required` (428) are added to `src/lib/errors.ts` as part of the contract.
