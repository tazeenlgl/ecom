# Acceptance criteria

Status: **proposal.** Each criterion is testable; "T" names the test level (U unit, A API integration on a disposable `_test` database, C admin component, S storefront render, E browser E2E, M manual review). A phase is accepted only when its criteria pass in CI-equivalent local runs and `typecheck`, tests, `build` and the OpenAPI drift check are green. Phases refer to [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## A. Storefront SEO output (Phase 1)

| ID | Criterion | T |
| --- | --- | --- |
| A1 | A published product page contains exactly one `<link rel="canonical">`, absolute https, on the store's primary verified domain; an `seo.canonicalUrl` on another domain is ignored | S |
| A2 | `seo.noIndex = true` renders `robots: noindex,nofollow` and the product is absent from `/sitemap.xml` | S |
| A3 | `<title>` uses `seo.title` when set, else the product title; Open Graph title equals the resolved title (not always the raw title) | S |
| A4 | Meta description falls back to the description trimmed at a word boundary to ≤155 chars with no `- ` bullet markers; omitted when there is no text | U |
| A5 | OG tags include `og:url`, `og:image` (with width/height/alt when stored); Twitter card is `summary_large_image` with an image else `summary` | S |
| A6 | Product JSON-LD has one `Offer` per active priced variant with `price`, `priceCurrency`, `url`, `sku` | S |
| A7 | **When POS stock is unknown (no stock row), the JSON-LD omits `availability`**; with stock >0 it is `InStock`; with stock 0 `OutOfStock` | S |
| A8 | Breadcrumb JSON-LD lists Home → category chain → product with absolute URLs; absent when the product has no category | S |
| A9 | Sitemap `lastmod` is the product's update time; draft, archived and `noIndex` products are not listed | S |
| A10 | No `keywords` meta tag exists anywhere | S |
| A11 | JSON-LD output cannot break out of the script tag (`<` escaped) with hostile text in title/description | U |

## B. Editor shell, concurrency, audit (Phase 1)

| ID | Criterion | T |
| --- | --- | --- |
| B1 | `GET product` returns `version`; every product write increments it | A |
| B2 | `PATCH` with a stale `expectedVersion` returns 409 `conflict` with the current version and changes nothing | A |
| B3 | The editor shows a conflict dialog (reload / keep my changes view) and never overwrites silently | C/E |
| B4 | Unsaved changes prompt before navigating away; Save sends only changed fields | C |
| B5 | Every product, variant, media and content write produces an audit row in the same transaction; SEO/description updates record changed field names and a bounded before/after | A |
| B6 | Cross-store ids (category, collection, size chart, media, variant, product type) return 404 and write nothing | A |
| B7 | `catalogue.read` can view but not edit; price inputs are disabled without `pricing.write`; the API rejects both regardless of UI | A/C |
| B8 | Media `PATCH` updates alt/variant/featured; `PUT order` rejects ids from another product or store and is atomic | A |

## C. Basic information, organization, specifications (Phase 1-2)

| ID | Criterion | T |
| --- | --- | --- |
| C1 | Title, description, slug validate with the same rules as the API; slug uniqueness conflict is shown on the field | C/A |
| C2 | Specifications can be added, reordered and removed; 50-row limit enforced | C/A |
| C3 | Collections can be assigned from the product page; a collection of another store cannot be assigned | A |
| C4 | Tags: lower-cased, ≤40 chars, deduplicated; usable for storefront filtering later; absent from meta keywords | A |

## D. Product types, attributes, templates (Phase 2)

| ID | Criterion | T |
| --- | --- | --- |
| D1 | A product type can be created without any apparel-specific code or seed; apparel attributes exist only as rows | A/M |
| D2 | A template entry references a definition of the same store only; deleting a definition in use is refused with a usage list | A |
| D3 | The attributes card renders fields in template order and groups, with required markers and the correct control per type (text, number, boolean, select with options) | C |
| D4 | Publishing a typed product with a missing required product-level attribute returns 409 listing the attributes; saving a draft does not | A |
| D5 | Changing a product's type keeps existing attribute values; the UI shows which values become "not in template" | C/A |
| D6 | Renaming a select option rewrites stored product and variant values transactionally and audits it | A |
| D7 | Filterable flag is configurable; (storefront filtering itself is out of scope here and recorded as such) | A |
| D8 | Untyped (legacy) products still open, edit and publish exactly as before | A |

## E. Size charts, tax (Phase 2)

| ID | Criterion | T |
| --- | --- | --- |
| E1 | A size chart can be created and edited in a grid (columns, rows, unit, notes) with consistent row lengths | C/A |
| E2 | The editor previews the chart as shoppers see it; a product type may default a chart | C |
| E3 | GST 0-28% and HSN 4-8 digits validated; values stored as basis points and digits only (unchanged) | A |

## F. Variants, SKU mapping, pricing, variant media (Phase 3)

| ID | Criterion | T |
| --- | --- | --- |
| F1 | Choosing axes with N and M values shows N×M combination rows; none are saved until a POS SKU code is entered | C |
| F2 | The system never generates a SKU code; empty SKU rows cannot be submitted | C/A |
| F3 | Duplicate SKU in the store returns 409 and is shown on the row; duplicate option set on the same product is refused | A |
| F4 | Variant option values must exist in the variant-scope definition (existing validation) | A |
| F5 | Price save writes `variant_prices` and a `price_history` row; price above MRP refused; requires `pricing.write` | A |
| F6 | Price history lists changes with actor and time | A/C |
| F7 | A variant image can be assigned to a variant of the same product only; the storefront shows it for that variant and shared images otherwise | A/S |
| F8 | No control edits stock; stock status is shown read-only or as "unknown" | C/M |

## G. Content generation and field modes (Phase 4)

| ID | Criterion | T |
| --- | --- | --- |
| G1 | Each generatable field has an independent mode (auto/manual) and status, persisted | A |
| G2 | Editing a field flips it to manual/`edited`; a later product save or fact change never alters its value | A |
| G3 | Suggest never changes the stored value; Apply requires the preview's `base_value_hash` to match the current value, else 409 | A |
| G4 | Facts change on an unedited auto field → `stale` + pending suggestion; on an edited field → nothing changes | A |
| G5 | With insufficient facts the response lists the missing facts and returns no text | U/A |
| G6 | Generated text contains only tokens derivable from the facts (output guard test with injected invention is rejected) | U |
| G7 | A throwing/failing generator leaves product save, field editing and publishing fully working; field shows `failed` | A/C |
| G8 | Generation endpoints enforce `catalogue.write`, tenancy, rate limits; apply/discard audited | A |
| G9 | Slug auto mode applies only to never-published products; changing a published slug stores a redirect and `GET old` returns 301 to new | A/S |
| G10 | No network call, credential or AI SDK exists in the default build (verified by grep in review) | M |

## H. Preview and readiness (Phase 4-6)

| ID | Criterion | T |
| --- | --- | --- |
| H1 | `readiness` returns blocking and advisory items; publish returns 409 with the same blocking list | A |
| H2 | Stock is never a blocker; unknown stock is reported as information | A |
| H3 | Draft preview needs a valid signed token, expires, is `noindex`, `no-store`, and does not appear in sitemap | S/A |
| H4 | SERP and share previews reflect the resolved (not just stored) values | C |

## I. Media (Phase 5)

| ID | Criterion | T |
| --- | --- | --- |
| I1 | With `MEDIA_STORE` unconfigured, upload endpoints return 501 and the https-URL path still works | A |
| I2 | JPEG/PNG/WebP up to the size limit upload and finalize; SVG, GIF, wrong magic bytes, oversize and oversize-pixel files are rejected without storing public objects | A |
| I3 | Finalize is idempotent; an upload id from another store/product/admin is refused | A |
| I4 | Stored public image has EXIF/GPS removed and a content-hashed key containing no client filename | A |
| I5 | Featured image is unique per product; reorder persists; deleting the OG image falls back safely | A |
| I6 | Alt text editable and generated-on-request; empty alt only when marked decorative | A/C |
| I7 | `next.config` image hosts are limited to approved hosts | M/S |
| I8 | Existing external-URL media continues to render | S |

## J. Cross-cutting (every phase)

| ID | Criterion | T |
| --- | --- | --- |
| J1 | Migrations are additive; applied twice and on a populated copy without error or data change | A |
| J2 | `docs/openapi.json` regenerated and CI drift check passes | CI |
| J3 | Typecheck, API tests (run twice for flake), admin/web tests and build pass | CI |
| J4 | Keyboard-only completion of create → edit → publish in the editor; labelled controls; visible focus | E/M |
| J5 | Docs updated: ADMIN, DATABASE, ER_DIAGRAM, MIGRATIONS, SECURITY, KNOWN_ISSUES, IMPLEMENTATION_PLAN, CHANGELOG, DECISIONS | M |
| J6 | No secret, credential, live-provider call or deployment introduced; no production migration run | M |
| J7 | A published product created before this work (no type, no field state) displays identically on the storefront except for the SEO fixes in group A | S |

## K. Out of scope (recorded so it is not assumed)

Storefront faceted filtering by attributes; reviews and `aggregateRating`; video; multilingual content; a live model-backed generator; a real storage provider adapter; POS stock editing; production deployment; production migration.

## L. Image URL and optimizer security (R2, Phase 5)

| ID | Criterion | T |
| --- | --- | --- |
| L1 | `next.config` contains no wildcard host; `remotePatterns` are generated from `MEDIA_ALLOWED_HOSTS`; production refuses to start with an empty list | U/A |
| L2 | The URL validator rejects userinfo, every IP-literal form, localhost/local/internal names, trailing-dot hosts, non-default ports, fragments, control characters, backslash tricks and over-length URLs, and normalises case/punycode | U |
| L3 | Media, store logo/favicon and content-block routes reject non-allow-listed hosts and store nothing | A |
| L4 | `/_next/image` returns 400 and makes **no upstream request** for non-allow-listed hosts, IP literals, protocol-relative and recursive URLs | S |
| L5 | A redirect from an allowed host to a disallowed or `http://` target is not followed (**known gap in Next 15.5.29; acceptance requires the chosen mitigation to pass**) | S |
| L6 | Over-size, slow, non-image and SVG upstream bodies are refused within the configured limits and not cached | S |
| L7 | The image disk cache stays below its configured cap under a many-distinct-URL load | S |
| L8 | Unlisted legacy hosts render unoptimized; `og:image`/JSON-LD omit non-allow-listed images | S |
| L9 | Upload finalize rejects wrong magic bytes, SVG/GIF, oversize, pixel bombs, foreign or replayed upload ids, and strips metadata | A |
| L10 | No server code fetches an admin-supplied URL (verified by code search and review) | M |

## M. Versioning and concurrent editing (R3)

| ID | Criterion | T |
| --- | --- | --- |
| M1 | Every mutating product/variant/media/tag/collection-assignment/publish route requires `expectedVersion`; missing → 428 `version_required` | A |
| M2 | A stale version → 409 `stale_version` with the current record; nothing is written (row, audit and child tables unchanged) | A |
| M3 | Ten concurrent `PATCH` requests with the same version: exactly one 200 and nine 409; final version = start + 1 | A |
| M4 | Edit vs publish, edit vs media reorder, edit vs suggestion apply: the second request using the old version fails | A |
| M5 | Price edit (variant version) does not conflict with a content edit (product version) and vice versa | A |
| M6 | Version never decreases or repeats; cross-store id returns 404 not 409 | A |
| M7 | Admin shows a conflict panel with yours/current/original per field, keeps unsaved input, and a subsequent Save succeeds with the new version | C/E |
| M8 | A request with a stale cached admin build gets 428 and the page offers reload without losing input | C |

## N. Additions to earlier groups (second review)

| ID | Criterion | T |
| --- | --- | --- |
| N1 (A4) | Meta description follows SEO doc C1: whole sentences ≤155 chars, never cut mid-sentence, omitted rather than mechanically truncated; tables of cases incl. Devanagari text | U |
| N2 (A7) | `stock` is `in_stock`/`out_of_stock`/`unknown`; JSON-LD `availability` appears only for the first two; page and OG follow the same rule; a product with all variants unknown has no availability anywhere | S |
| N3 (A1) | No verified primary domain → no canonical and `noindex`; a canonical on another store's domain is ignored | S |
| N4 (A9) | `lastmod` equals product `updated_at`; unchanged products keep the same `lastmod` across requests | S |
| N5 (G3) | Apply is refused when either the value hash or the product version is stale; a newer suggestion expires the older | A |
| N6 (G2) | Migration `0007` inserts zero state rows; all pre-existing content reads as manual; content columns unchanged byte-for-byte | A |
| N7 (G5) | The template generator is deterministic: repeated runs and reordered fact keys give identical output | U |
| N8 (D) | Product types are store-scoped: a type cannot reference another store's definition, group, chart or template; two stores may reuse the same type code | A |
| N9 (D) | Products without options can be sold through a single variant mapped to a POS SKU; no SKU is generated | A/C |
| N10 (D) | Required attributes block publish, not draft save; required variant attributes are checked on every active variant | A |
| N11 (D) | Existing products and variants open, edit and publish unchanged with `product_type_id` null | A |
