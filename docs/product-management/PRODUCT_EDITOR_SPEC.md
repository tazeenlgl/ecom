# Product editor specification

Status: **proposal, nothing implemented.** Written 2026-11-06 against `main` at `e03b827` (application code identical to the inspected working tree, branch `feature/tazeen-ecommerce` at `7003597`; only `CLAUDE.md`, `CNAME` and `ecom-context.md` differ). Every statement under "Existing" was read in code; items under "Proposed" are design, not behaviour. Companion documents: [PRODUCT_DATA_MODEL.md](PRODUCT_DATA_MODEL.md), [SEO_AND_CONTENT_GENERATION.md](SEO_AND_CONTENT_GENERATION.md), [MEDIA_ARCHITECTURE.md](MEDIA_ARCHITECTURE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).

## 1. What exists today (verified in code)

| Area | Current behaviour | Where |
| --- | --- | --- |
| Product list | Cursor-paged table, filters `status` and title substring `q`. No sort, no image/price/stock columns, no bulk actions | `apps/admin/app/(app)/s/[storeId]/products/page.tsx` (52 lines), `GET /stores/:storeId/products` |
| Create | One short form: title, slug (auto from title until edited), description (plain text), GST %, HSN, size chart (select), category chips. Creates a `draft` | `products/product-form.tsx` (106 lines), `products/new/page.tsx` |
| Edit | Same form, plus three cards: **Variants and pricing** (add/edit variant, SKU, name, status, MRP, selling price, price-history modal), **Photos** (add by https URL, delete), status change (publish/unpublish/archive) | `products/[id]/page.tsx` (328 lines) |
| Attributes | API has attribute-definition list/create/patch (scope product or variant; text/number/boolean/select; options; filterable; position). **No admin UI at all**, and the product form cannot set attribute values, specifications or SEO | `catalogue/admin-routes.ts` lines 46-116, `catalogue/attributes.ts` |
| Size charts | API list/create/update. Product form can only *select* one. **No chart editor in the admin** | `admin-routes.ts` 170-205 |
| Collections | Admin page exists; product membership is set from the collection side (`PUT .../collections/:id/products`). The product editor does not show collections | `collections/page.tsx` |
| Media | `POST /products/:id/media` (https URL up to 1000 chars, kind, variantId, altText, width/height, position) and `DELETE /media/:id`. **No update/reorder route**, so alt text, order and variant link cannot be changed after creation | `admin-routes.ts` 512-558 |
| Publishing | `POST .../status`; publishing requires one active variant with a price (409 otherwise). Edits to a published product are live immediately | `admin-routes.ts` 377-408 |
| Concurrency | `PATCH` has no version or `If-Match` check: the last write wins silently | `admin-routes.ts` 359-375 |
| Audit | Every write calls `recordAudit` in its transaction. Product updates log **field names only**, not before/after values | `lib/audit.ts` |
| Permissions | `catalogue.read`, `catalogue.write`, `pricing.write` (price changes). Checked by `defineRoute` per store | `iam/permissions.ts` |

Gaps relevant to this initiative, from the above: no product types, no tags, no required/group/order rules for attributes, no attribute-value or specification editing, no SEO editing, no social metadata, no media upload/reorder/alt editing, no variant-option matrix, no readiness check, no draft preview, no field-level auto/manual state, no optimistic locking.

## 2. Design principles

1. **The API enforces, the UI guides** (CLAUDE.md). Required fields, publish rules and ownership are checked server-side; the editor only mirrors them.
2. **Nothing apparel-specific in code.** Size, colour, fabric, fit, wash care exist only as `attribute_definitions` rows and product-type templates a store configures.
3. **POS owns SKU and stock.** The editor never mints a SKU and never edits stock. Variant rows exist only once mapped to a POS SKU code.
4. **No silent overwrite.** Manual text is never replaced by generated text without an explicit, previewed accept. Concurrent edits are detected (`version`).
5. **Generation can fail without blocking.** Saving a product never calls a generator.
6. **Prices stay integer paise, GST-inclusive**; price changes need `pricing.write` and keep writing `price_history`.

## 3. Proposed screen structure

Route: `/s/[storeId]/products/new` and `/s/[storeId]/products/[id]` (existing routes, new layout). A two-column page: main column of cards, right rail with **Status**, **Product organization** and **Publishing readiness**. A sticky save bar shows unsaved changes, the version being edited, and Save / Discard. Draft products autosave nothing; only Save writes.

| # | Card | Contents | Source of truth |
| --- | --- | --- | --- |
| 1 | Basic information | Title; description (plain text with the existing `- ` bullet convention, optional description template insert); slug with Auto/Manual toggle and storefront URL preview | `products.title/description/slug` |
| 2 | Product organization (rail) | Product type; categories (existing chips); collections (new multi-select, writes via a product-side route); tags | `products.product_type_id`, `product_categories`, `collection_products`, `product_tags` |
| 3 | Attributes | Fields generated from the product type's template, grouped and ordered; required marker; text/number/boolean/select inputs; "extra attributes" picker for definitions not in the template | `products.attributes` validated by definitions |
| 4 | Specifications | Free label/value rows (existing `specifications` column); reorder; optional "from attribute" prefill | `products.specifications` |
| 5 | Media | Gallery grid: upload (when enabled) or add https URL, drag to reorder, featured star, alt text with Auto/Manual, per-image variant assignment, delete | `product_media` |
| 6 | Variants | Option axes (variant-scope attributes) chosen per product; combination grid; each row maps to a POS SKU code (typed, or picked if `capabilities().listSkus`); status; weight; per-row images | `product_variants.options`, `products.variant_axes` |
| 7 | Pricing | Per variant MRP and selling price, discount % preview, price history drawer. Visible but read-only without `pricing.write` | `variant_prices`, `price_history` |
| 8 | Size chart | Select a chart, preview it, link to the chart editor (new admin page). Measurements live in the chart (`columns`/`rows`/`unit`) | `size_charts` |
| 9 | Tax | GST % and HSN with validation (4-8 digits, existing) | `products.tax_rate_bps/hsn_code` |
| 10 | Search engine listing | Title and meta description with Auto/Manual and character meters, canonical, "hide from search engines" (`noIndex`), live SERP-style preview | `products.seo` |
| 11 | Social sharing | OG title, OG description, sharing image picker from the gallery, Twitter card type, each with Auto/Manual | `products.seo` (extended) |
| 12 | Preview and readiness | Draft preview link (signed, short-lived, noindex), readiness checklist, publish button | computed |

### 3.1 Generation controls (cards 1, 5, 10, 11)

Each generatable field shows a mode switch (**Auto** / **Manual**), a status chip (`empty`, `generated`, `edited`, `stale`, `failed`, `insufficient data`), and a **Suggest** action. Suggest opens a side-by-side diff (current vs proposed) with the facts used, and **Apply** / **Discard**. Typing in a field flips it to Manual and status `edited`. Detail: [SEO_AND_CONTENT_GENERATION.md](SEO_AND_CONTENT_GENERATION.md).

### 3.2 Publishing readiness (card 12)

Computed on the server (`GET .../products/:id/readiness`) so the UI and the publish route share one result. Blocking items prevent publish (409 with the list); advisory items do not.

| Check | Level |
| --- | --- |
| At least one active variant with a price | Blocking (exists today) |
| Every active variant has a POS SKU code | Blocking (always true for persisted rows; unmapped grid rows are listed) |
| Required template attributes filled (product and variant level) | Blocking |
| Title and slug valid | Blocking |
| At least one image, and a featured image | Advisory (Blocking if the store sets `requireImageToPublish`, open decision) |
| Alt text present on every image | Advisory |
| Meta title/description within length, not duplicated by another product | Advisory |
| HSN set | Advisory (blocking is a tax-owner decision) |
| Category assigned | Advisory |
| Size chart when the product type says one is expected | Advisory |
| Stock | **Never a check**: stock is the POS's and may be unknown; readiness reports "stock unknown" without blocking |

## 4. Admin configuration screens (new)

| Screen | Purpose | Backed by |
| --- | --- | --- |
| Product types | Create/rename/archive types; edit template (attributes, required, order, groups); choose default size chart, default tax and description template | new `product_types` + `product_type_attributes` |
| Attribute definitions | List/create/edit (label, options with add/reorder, filterable, scope); delete only when unused | existing routes plus new delete and usage count |
| Variant option definitions | Same screen filtered to scope `variant`, flag "usable as variant axis" | existing definitions + template flag |
| Size charts | Editable grid (columns, rows, unit, notes), duplicate, usage count | existing routes (UI is new) |
| Description templates | Named templates with placeholders drawn from verified facts, e.g. `{title}`, `{attribute:fabric}`; preview against a sample product | new `content_templates` |
| Tags | Autocomplete from existing tags; merge/rename later | new `product_tags` |

Sidebar placement: a **Catalogue setup** group under Products (Types, Attributes, Size charts, Templates), gated by `catalogue.write`.

## 5. API changes (summary; detail in the data model)

New: product types CRUD; template entries; attribute delete + usage; tags; product-side collection assignment; `PATCH /media/:id` and `PUT /products/:id/media/order`; readiness; suggestion create/apply/discard; content templates; media upload-session and finalize (when approved); slug-redirect lookup (storefront); preview token. Changed: product `GET` returns `version`, `productTypeId`, `tags`, `variantAxes`, field states; `PATCH` requires `expectedVersion` (additive: absent = current behaviour for one release, then required); `seoSchema` gains OG/Twitter fields; publish route runs the readiness blockers. All defined with `defineRoute`, Zod schemas without `.default()` for `PATCH`, audit in-transaction, `docs/openapi.json` regenerated.

## 6. Frontend components

Reuse `Card`, `Field`, `Modal`, `DataTable`, `useFetch`, `useStore().can()` from `apps/admin/components/ui.tsx` and `lib/*`. New shared components: `ModeField` (input + Auto/Manual + status chip + Suggest), `SuggestionDiff`, `AttributeForm` (renders from a template), `OptionMatrix`, `MediaGallery` (sortable list, keyboard reorder, alt editor), `SerpPreview`, `SharePreview`, `ReadinessPanel`, `SizeChartEditor`, `UnsavedBar`. Accessibility: all controls keyboard-operable (reorder via buttons as well as drag), labelled, errors tied to fields; the existing admin conventions apply.

## 7. Permissions and security

- Reads `catalogue.read`; writes `catalogue.write`; price fields `pricing.write` (unchanged). Setup screens (types, attributes, templates) use `catalogue.write` initially; a separate `catalogue.configure` permission is an open decision because it changes the role table in `iam/permissions.ts`.
- Generation endpoints require `catalogue.write`, are rate-limited per admin, and never accept a store id from the body (`:storeId` in path as everywhere).
- Free text rendered in the admin is escaped by React; storefront JSON-LD already escapes `<`. Suggestions are plain text, length-limited, and stripped of markup before storage.
- Every create/update/delete/apply writes an audit row; product updates should additionally log changed field names **and** a short before/after for SEO/content fields (new, still no secrets).
- The editor never shows or accepts POS credentials, stock quantities for editing, or payment data.

## 8. Testing strategy

API (Vitest on a disposable `_test` PostgreSQL, as today): tenancy isolation for every new route (cross-store id injection returns 404), permission matrix, required-attribute enforcement, version conflict (409), readiness results, suggestion lifecycle, media route validation, migration up on a populated copy. Admin: component tests for `ModeField` state transitions, `AttributeForm` from a template, `OptionMatrix` combination logic; the existing `e2e-roles.mjs` is extended for the new routes. Storefront: unit tests of the metadata/JSON-LD builder (pure function) including the stock-unknown case. New: a browser E2E smoke (create typed product, upload fake image, publish, view storefront tags) run locally and, once approved, in CI. Detail: [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).

## 9. Deployment dependencies and rollback

Each phase ships additive migrations only (never edited once merged; CLAUDE.md rule 8). Rollback is "redeploy the previous image": old code ignores the new nullable columns and tables. Media upload depends on an owner-approved storage choice and credentials in a secret store; until then the editor keeps the https-URL path. No phase needs a live external provider. Production migration needs separate owner approval and a backup.

## 10. Second-review additions

### 10.1 Stale updates and admin recovery

1. Every save sends `expectedVersion` (product) and, for variant/price edits, the variant's version. A 409 `stale_version` response includes the current record and `updatedAt/updatedBy` of the winning write.
2. The editor keeps the user's unsaved form state and shows a conflict panel listing, per field, **yours / current / original** values. Fields the other writer did not change are pre-selected as "keep mine"; fields both changed need a choice; **no automatic field merge writes anything**, the user presses Save again, which resubmits with the new version.
3. Choices: *Keep mine* (resubmit on top of current), *Use current* (discard my change), *Copy mine* (clipboard) and *Reload*. Nothing is lost silently: the unsent text stays in the page until dismissed.
4. 428 `version_required` (stale cached admin build) shows "This page is out of date. Reload." and preserves form state in session storage so a reload can restore it.
5. Child edits that bump the product version (media order, tags) refresh the version in place when their own request succeeds, so a user's own sequence of edits never conflicts with itself; the sticky bar shows "Updated by X at hh:mm" when another admin's write is detected on the next fetch.
6. Publish/archive carries the version so publishing cannot apply to a product someone changed a moment ago without the publisher seeing it.

### 10.2 Image URL handling in the editor

Photo URLs are validated client- and server-side against the shared host policy (MEDIA_ARCHITECTURE section 7.2) and the editor says which hosts are accepted; arbitrary hosts are no longer silently accepted. Until uploads exist, staff use URLs on allow-listed hosts or ask an administrator to add a host (a platform-level setting, audited).
