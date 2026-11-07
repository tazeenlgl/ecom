# SEO and content generation

Status: **proposal, nothing implemented.** Baseline `main` `e03b827`. Part A records what the storefront does today (read in code); Part B is the design.

## Part A. Current SEO output (verified)

| Item | Today | Evidence |
| --- | --- | --- |
| Title tag | `seo.title ?? product.title`, wrapped by the store template `%s \| Store` | `apps/web/app/p/[slug]/page.tsx:17`, `app/layout.tsx:28-36` |
| Meta description | `seo.description ?? description.slice(0, 160)`: a raw cut that can end mid-word and can include the `- ` bullet markers | `p/[slug]/page.tsx:15` |
| Canonical URL | **Not emitted.** `seo.canonicalUrl` is stored and returned by the API but never rendered | grep: no `alternates`/`canonical` in `apps/web` |
| Robots / noindex | **Not honoured for products.** `seo.noIndex` is stored but ignored; only the "store not found" page sets `robots: {index:false}`. `robots.txt` blocks `/account /checkout /login /api/` and points to `/sitemap.xml` | `layout.tsx:30`, `app/robots.ts` |
| Open Graph | `title: product.title` (ignores `seo.title`), description, first image URL. No `og:url`, no `og:type=product`, no dimensions, no alt | `p/[slug]/page.tsx:19` |
| Twitter/X | **None.** | grep |
| Product JSON-LD | `Product` with name, description, images, `sku` = first variant, brand = store brand name, `AggregateOffer` low/high price, `offerCount`. **`availability` is `OutOfStock` whenever no variant has stock, including when stock is simply unknown** (`inStock` is `false` for a missing POS row). No `offers.url`, no per-variant `Offer`s, no `priceValidUntil` | `p/[slug]/page.tsx:29-47`, `storefront-routes.ts:158` |
| Breadcrumb JSON-LD | **None** (also none on categories/collections) | grep |
| Sitemap | `/sitemap.xml` lists home, shop, categories, collections and **all published products** (pages of 100, capped at 5000). `lastModified` is `createdAt`, not the update time. Ignores `noIndex`. Host comes from the request's store host, not necessarily the primary verified domain | `apps/web/app/sitemap.ts` |
| Image alt | Stored as `alt_text` and returned by the API; entry is optional and there is no way to edit it after creation | `admin-routes.ts` media routes |
| Meta keywords | Not present, and not to be added | n/a |

Correctness issues found (each is a defect in current behaviour, independent of the new editor, and each is cheap to fix with a unit-tested pure function): (1) unknown stock is reported as `OutOfStock`, which contradicts "do not claim availability or its absence without POS data"; (2) `noIndex` and `canonicalUrl` set in the API have no effect; (3) OG title ignores the SEO title; (4) `lastmod` is the creation time; (5) the description fallback cuts text mechanically.

## Part B. Design

### B1. Storefront rendering: where metadata is resolved

**Decision: resolve on the API, render on the web.** `GET /v1/storefront/products/:slug` gains a `seo` object already resolved with the fallback chain below, so there is one tested implementation (`buildProductSeo`, a pure function in `modules/catalogue`) and the web only maps it to Next.js `Metadata`/JSON-LD. The primary verified domain (`store_domains.is_primary` + `verified_at`) supplies the canonical origin; if none exists the canonical is omitted rather than guessed.

Fallback chain (first non-empty wins; every value is plain text, trimmed, whitespace-collapsed):

| Output | Chain |
| --- | --- |
| `<title>` | `seo.title` → product title (store template applies) |
| Meta description | `seo.description` → description trimmed to ≤155 chars at a sentence/word boundary with bullet markers removed → omitted |
| Canonical | `seo.canonicalUrl` (must be https and on a verified store domain, else ignored) → `https://{primary domain}/p/{slug}` |
| Robots | `noindex,nofollow` when `seo.noIndex` or the product is not published; otherwise default |
| `og:title` / `og:description` | `seo.ogTitle` / `seo.ogDescription` → the resolved title / description above |
| `og:image` | `seo.ogImageMediaId` → featured image → first image → store default share image → omitted. Include width, height, alt when known |
| `og:type`, `og:url`, `og:site_name` | `product` (not a Facebook-validated commerce type; plain `website` is acceptable fallback), canonical URL, store name |
| Twitter | `summary_large_image` when an image exists else `summary`; title/description/image from the OG values; no handle unless the store sets one |
| Breadcrumb JSON-LD | Home → primary category (first category by position, parent chain) → product, with absolute URLs; omitted when the product has no category |
| Product JSON-LD | `Product` with `@id` = canonical, name, plain-text description, images (absolute), `brand` (store brand), `sku` per `Offer`, `Offer` per active priced variant with `price` (rupees, two decimals), `priceCurrency`, `url` |
| `availability` | Emitted **only** when the POS gave a number: `InStock` if `available > 0`, `OutOfStock` if `0`; **omitted when stock is unknown** (`posStockLevels` row absent or `stock_unknown`). The API already exposes `inStock`; it needs a tri-state (`true`/`false`/`null`) |
| Sitemap eligibility | Published, not `noIndex`, at least one active priced variant, canonical host equals the sitemap host; `lastmod` = max(`products.updated_at`, price/media change) |

Not added: `aggregateRating`/`review` (no review data exists), `gtin`/`mpn` (not held), meta keywords, hreflang (single language), AMP.

### B2. Indexing and publication rules

Draft/archived products return 404 on the storefront (already true) and are absent from the sitemap. A published product with `noIndex` renders but is excluded from the sitemap and gets a robots meta tag. When a published product is archived or its slug changes, the old URL answers 301 (slug change, `slug_redirects`) or 410/404 (archive). Preview of drafts uses a signed token (short TTL, `noindex`, `Cache-Control: no-store`) so a draft is never publicly indexable.

### B3. Provider-independent generation service

Goal: suggest text for description, SEO title, meta description, slug, image alt text, OG title/description from **verified facts only**, never block editing, never overwrite manual work.

```
interface ContentGenerator {
  readonly id: string;                         // 'template-v1', later e.g. 'llm:<name>'
  capabilities(): { fields: FieldKey[]; usesExternalService: boolean };
  generate(req: { field: FieldKey; facts: VerifiedFacts; locale: 'en-IN';
                  constraints: { maxLength: number; plainText: true } }): Promise<
      | { kind: 'ok'; value: string; usedFacts: FactKey[] }
      | { kind: 'insufficient_data'; missing: FactKey[] }
      | { kind: 'failed'; reason: string } >;
}
```

* **Default and only implementation in scope: `TemplateGenerator`.** Deterministic, no network, no credentials, no model. It assembles text from description templates and fact slots (title, brand name, product type name, set attribute values, category name). A clause whose fact is missing is dropped. This already satisfies "never invent": it can only restate facts.
* **`VerifiedFacts`** is built by one function from database rows: title, brand/store name, product type, **only attributes that have a value**, specification rows, category names, variant option *values* that exist, and (for alt text) the image's product/variant context. It excludes price, discount, stock, delivery or material claims unless held as an attribute. Each fact has a key so output can cite `usedFacts`.
* **Output guard** (applies to any generator, mandatory for a future LLM one): plain text only, length ≤ field limit, no URLs, no digits or proper nouns that are absent from the facts (checked against a token allow-list built from the facts), no superlatives/medical/guarantee words from a configurable deny-list. A violation turns the result into `failed` with the reason; nothing is stored.
* **A model-backed adapter is optional, off by default, and out of scope until the owner approves a provider, a data-processing position (product data leaves the system), a cost limit and a secret-store location.** The interface exists so it can be added without touching the editor. No credential, SDK or provider name is added by this plan.

### B4. Field-level modes, status and persistence

Persisted in `content_field_states` and `content_suggestions` ([PRODUCT_DATA_MODEL.md](PRODUCT_DATA_MODEL.md) D6). Fields covered: `description`, `seo.title`, `seo.description`, `slug`, image `alt_text`, `og.title`, `og.description`, `og.image` (the last is *selection*, not text: the generator may only choose among the product's own images).

State machine (per field):

| Event | mode | status |
| --- | --- | --- |
| Row absent (all existing data) | manual | derived: `empty` or `edited` |
| Admin switches to Auto on an empty field | auto | `empty` → eligible for auto-fill |
| Auto-fill of an **empty** field (on save or on "Fill empty") | auto | `generated`, `value_hash` recorded |
| Admin types in the field | **manual** | `edited` (switch is explicit and visible; generated hash dropped) |
| Source facts change while mode=auto and value still equals `value_hash` | auto | `stale` + a pending suggestion is created |
| Source facts change while value was edited | unchanged | unchanged; no suggestion |
| Admin presses Suggest | unchanged | creates a pending suggestion; value untouched |
| Admin applies a suggestion | auto (if chosen) or manual | `generated`; `value_hash` = new value; audit row |
| Generation error | unchanged | `failed` + `last_error`; field remains editable |
| Not enough facts | unchanged | `insufficient_data` + `missing` list shown |

Invariants: (1) the only code path that writes a generated value over a non-empty value is **apply suggestion**, which requires the preview to have been fetched and `base_value_hash` to still equal the current value (else 409 "changed since preview"); (2) saving a product through the normal `PATCH` never touches content-field state except flipping edited fields to manual; (3) a missing `content_field_states` row means manual, so migration changes nothing; (4) regeneration is per field, never "regenerate everything"; a bulk "fill empty fields" action creates suggestions or fills empty fields only; (5) generation runs only from its own endpoint (and, for bulk, a job via `enqueueJob`), never inside the product save transaction, so a failing generator cannot block saving.

### B5. Generation rules per field

| Field | Limit | Auto source | Notes |
| --- | --- | --- | --- |
| Description | 20000 (API) | Description template + attributes/specs | Plain text with `- ` bullets, matching the storefront renderer |
| SEO title | ≤ 60 chars recommended, 200 hard | title + product type/brand | Brand suffix comes from the store template; not duplicated |
| Meta description | ≤ 155 recommended, 500 hard | first sentences of description or attribute summary | |
| Slug | 120, `^[a-z0-9]+(-[a-z0-9]+)*$` | title | **Auto only while never published.** After publish, changes are manual and create a redirect |
| Image alt | 300 | product title + variant option values (e.g. colour) + view if known | "Image of" prefixes avoided; decorative images may have empty alt |
| OG title / description | 95 / 200 recommended | SEO title / description | Default is to follow SEO fields (no separate state) unless set |
| OG image | n/a | selection among product images (featured first) | |

### B6. Failure and degraded behaviour

Generator unavailable or erroring → status `failed`, toast with reason, editor fully usable. Insufficient facts → shows exactly which facts are missing ("add a fabric attribute") instead of filler. Suggestions expire after 7 days (job) so stale previews cannot be applied.

### B7. Security and privacy

Endpoints: `POST /stores/:storeId/products/:id/content/suggest` (body: field), `GET .../suggestions`, `POST .../suggestions/:sid/apply`, `POST .../suggestions/:sid/discard`; permission `catalogue.write`; rate-limited; audit on apply/discard (not on every preview); suggestion text stripped of markup. With only the template generator nothing leaves the system. If a model-backed generator is ever approved, send the minimum facts, never customer or order data, log request ids not payloads, and document it in `docs/SECURITY.md`.

### B8. Testing

Pure-function unit tests for `buildProductSeo` and the fact builder (missing facts, unknown stock, `noIndex`, off-domain canonical, long text trimming, bullet stripping); generator tests asserting the output guard rejects invented tokens; state-machine tests (manual survives product edit; stale appears only for unedited auto; apply with stale `base_value_hash` returns 409; failure leaves field editable); API tests for tenancy and permissions; storefront tests that rendered `<head>`/JSON-LD contain no `availability` when stock is unknown and exclude `noIndex` products from the sitemap.

## Part C. Second-review refinements

### C1. Meta description algorithm (replaces any mechanical truncation)

Input: the first available of `seo.description`, then the product description, then (only if the description is empty or unusable) the template summary built from set attributes.

1. If `seo.description` is set, use it as written (trimmed, whitespace collapsed). It is never shortened by the system; the editor warns above 155 characters and the API hard limit stays 500.
2. Otherwise take the description as plain text: remove `- ` bullet markers, collapse all whitespace and line breaks, drop URLs.
3. Split into sentences (on `.`, `!`, `?`, `।` followed by whitespace; abbreviations such as "Rs." are not split points when followed by a digit or lower-case letter).
4. Accumulate **whole sentences** while total length ≤ 155. If at least one sentence fits, use them.
5. If even the first sentence is longer than 155, **do not cut it**; fall back to the attribute-summary template (only facts that exist), and if that has fewer than two facts, omit the meta description entirely rather than publish a cut or invented one. Omission is valid: search engines write their own snippet.
6. Never append an ellipsis, never end mid-word, never include text that is not in the product's own fields.
7. A pure function with table tests (empty, bullets only, one 400-char sentence, three short sentences, Hindi/Devanagari text, emoji, HTML-looking text, sentence ending exactly at 155/156).

The same rules apply to `og:description` (limit 200) when it falls back.

### C2. Unknown stock and availability

The stock source is `pos_stock_levels` joined by `sku_code` and the store's POS location. States: **known with quantity > 0**, **known with quantity 0**, **unknown** (no row, no location, or a stale/failed sync). The API response carries `stock: 'in_stock' | 'out_of_stock' | 'unknown'` per variant (additive; `inStock` stays for compatibility until the web is switched). JSON-LD rules: an `Offer` includes `availability` only for the first two states; an `unknown` variant's `Offer` has `price` and no `availability`; the `Product` never claims `InStock` or `OutOfStock` as an aggregate unless every variant is known. Page text and Open Graph `product:availability` follow the same rule. The cart/checkout path is unchanged (it already returns `stock_unknown`).

### C3. Canonical, indexing and sitemap definitions

* Canonical = `https://` + primary verified domain of the resolved store + `/p/` + slug, with no query string or fragment, lower-case host, no trailing slash, regardless of the request URL or `Host` alias. If the store has no verified primary domain, no canonical is emitted and the page is `noindex` (fail safe). `seo.canonicalUrl` is honoured only when https, on a verified domain of the **same store**, and not a different product's URL.
* `noIndex` product: robots `noindex,nofollow`, excluded from the sitemap, no JSON-LD `Product` offers beyond what the page shows (kept, since the page renders), canonical still emitted.
* Sitemap: includes only published, indexable, priced products on the canonical host; `lastmod` = `products.updated_at` (and the later of variant/price/media changes once those bump a `content_updated_at`; until then `updated_at` only). Dates in W3C format; paging at 50,000 URLs or 50 MB per file with a sitemap index (current cap is 5,000 products; stay under it and document).
* `robots.txt` stays host-scoped and references the per-store sitemap.
* Slug redirect (301) targets are canonical URLs; old slugs never appear in the sitemap.

### C4. Concurrent edits, stale suggestions and silent-overwrite protection

Two independent guards protect the stored value; **both** must hold for Apply:

1. **Value guard:** `suggestion.base_value_hash` must equal the hash of the field's current value. If the value changed after the suggestion was made (by anyone), Apply returns 409 `suggestion_stale` and the suggestion is marked `expired`.
2. **Version guard:** Apply carries `expectedVersion` of the product (the same optimistic lock as every product write, see PRODUCT_DATA_MODEL D8). A stale version returns 409 `stale_version`; the editor reloads and re-previews.

Behaviours:

| Situation | Result |
| --- | --- |
| Admin A has a suggestion open; admin B edits that field and saves | A's Apply fails with `suggestion_stale`; A sees B's text and may request a new suggestion |
| Facts change (title, attribute) after a suggestion was created | The suggestion's `source_hash` no longer matches; it is shown as **outdated** with the changed facts, and Apply requires an explicit "apply anyway" confirmation or a re-suggest. It is never applied automatically |
| Same field, two pending suggestions | Only the newest is `pending`; creating one expires the previous one for that field |
| Auto-mode field, unedited, facts change | State becomes `stale`; a new pending suggestion is created; the stored value is untouched until Apply |
| Auto-mode field, user edits it between preview and apply | Edit flips mode to manual; the pending suggestion expires |
| Suggestion older than 7 days | Expired by a job or lazily on read (no scheduler exists in the repo today, so lazy expiry on read is the required behaviour) |
| Product published/archived meanwhile | Apply still allowed for draft/published; blocked for archived |
| Generator fails while A is previewing | `failed` state; stored value untouched; manual editing unaffected |

### C5. Determinism of the initial generator

`TemplateGenerator` is a pure function of `(field, VerifiedFacts, template, locale, constraints)`: no clock, randomness, network, environment or provider lookups; the same inputs always give byte-identical output. Tests assert identical output over repeated calls, independence from object key order, and that adding an unrelated fact does not change the text. Its version id (`template-v1`) is recorded with each suggestion so a template change is visible as a new generator version, not a silent change.

### C6. Existing content stays manual

Migration `0007` creates empty tables and inserts **no** `content_field_states` rows. A missing row means `mode = manual` for every field of every existing product, media row, category and collection. A migration test counts rows before and after and asserts the content columns are byte-identical. Auto mode starts only when an admin turns it on for a field.
