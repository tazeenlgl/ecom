# Implementation plan

Status: **plan only; implementation awaits owner approval of the decisions in section 2.** Baseline `main` `e03b827`. Companion: [PRODUCT_EDITOR_SPEC.md](PRODUCT_EDITOR_SPEC.md), [PRODUCT_DATA_MODEL.md](PRODUCT_DATA_MODEL.md), [SEO_AND_CONTENT_GENERATION.md](SEO_AND_CONTENT_GENERATION.md), [MEDIA_ARCHITECTURE.md](MEDIA_ARCHITECTURE.md), [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).

## 1. Summary of findings that shape the plan

1. The backend already has most primitives: store-scoped attribute definitions (text/number/boolean/select, product/variant scope, filterable, ordered), size charts, specifications, category and collection links, variants mapped to POS SKU codes, MRP/price with history, media metadata, an SEO jsonb, audit logging, and per-store permissions. The **admin UI exposes only a small part** of it (title, slug, description, GST/HSN, size-chart select, categories, variants/prices, photo URLs).
2. Missing in the API: product types and templates, required/group rules, tags, product-side collection assignment, media update/reorder/upload, optimistic locking, readiness, content-field state and suggestions, slug redirects, OG/Twitter fields.
3. The storefront has real defects independent of the new editor: unknown stock is published as `OutOfStock` in JSON-LD; `noIndex` and `canonicalUrl` are ignored; no canonical, Twitter or breadcrumb data; sitemap `lastmod` is creation time. These are fixed first because they are small, valuable and need no migration.
4. No new external provider is necessary for the core. Object storage/CDN is needed only for uploads (owner decision). Content generation ships with a deterministic template generator and no provider.
5. Test coverage for catalogue SEO output and for the admin product form is absent today (`apps/admin/test` has client-IP, security and e2e-roles; no product-form tests), and CI has no browser E2E.

## 2. Decisions needed from the owner before implementation

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| O1 | Approve the architecture: new `product_types` entity with a template join table; field-state tables; additive migrations `0005`-`0009` | Approve | Phase 2+ |
| O2 | Media: storage/CDN provider, region, budget, credentials holder; or stay on https URLs for now | Decide after Phase 3; list in MEDIA_ARCHITECTURE §4 | Phase 5 |
| O3 | Generation: template generator only for now, or also approve a model-backed provider (data leaves the system, cost, DPA) | Template only now | Phase 4 extension |
| O4 | Separate permission `catalogue.configure` for types/attributes/templates, or reuse `catalogue.write` | Reuse now, split later | Phase 2 |
| O5 | Require an image (and/or HSN, category) to publish? | Image advisory, HSN advisory; revisit per store | Phase 6 |
| O6 | Select option storage: keep strings or move to `{value,label}` | Keep strings; add a rename operation | Phase 2 |
| O7 | `expectedVersion`: optional first, or required immediately | **Required immediately** (second review: optional silently keeps last-write-wins); see PRODUCT_DATA_MODEL 5.4 | Phase 1b |
| O8 | Slug of published products: editable with redirect, or locked | Editable with redirect | Phase 4 |
| O9 | Video support | Out of scope | Phase 5 |
| O10 | Staging environment and browser-E2E in CI | Needed before any production use; none exists | Phase 7 |
| O11 | Repo is public: acceptable for design docs; confirm no merchant data in fixtures | Confirm | all |

## 3. Phases

Each phase is a separate branch and PR, ends with typecheck, tests, build, regenerated `docs/openapi.json`, and updated `CHANGELOG.md`, `docs/KNOWN_ISSUES.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/ADMIN.md`. No phase deploys, runs a production migration, or calls a live provider.

### Phase 0. Baseline and safety nets (no behaviour change)
* Add storefront tests that pin current head/JSON-LD output (characterisation) and an admin test harness for the product form.
* Record the read-only inventory plan for existing media hosts and duplicate variant option sets (queries, run on a copy only).
* Exit: tests green; no source change besides tests.

### Phase 1. Storefront SEO correctness and editor foundations (no schema except one column)
* Pure `buildProductSeo`/`buildProductJsonLd` in the API; storefront renders canonical, robots, OG (incl. SEO title), Twitter, breadcrumb, per-variant `Offer`s; **availability omitted when stock is unknown**; tri-state `inStock`.
* Sitemap: exclude `noIndex`; `lastmod` from `updated_at`; canonical host from the primary verified domain.
* Migration `0005_product_versioning`: `products.version`, `slug_redirects` (table unused until Phase 4). `PATCH` accepts optional `expectedVersion`.
* `PATCH /media/:id` (alt, variant, featured) and `PUT .../media/order`.
* Admin: editor shell with sticky save bar, version conflict handling, SEO card (title, description, canonical, noIndex, preview), Specifications card, Attributes card using **existing** definitions (no templates yet), collections multi-select, media gallery with reorder and alt editing (URL-based).
* Exit: acceptance criteria groups A, B, C.

### Phase 2. Product types, templates and catalogue setup screens
* Migration `0006`: `product_types`, `product_type_attributes`, `attribute_groups`, `product_tags`, definition columns, `products.product_type_id`, `products.variant_axes`.
* API: product types CRUD, template entries (required, order, group, variant axis), attribute delete-with-usage-check and option rename, tags, size-chart usage counts.
* Admin: Product types, Attribute definitions, Size chart editor, tags input; `AttributeForm` driven by the template; required markers.
* Publish route enforces required attributes; drafts stay incomplete-friendly.
* Exit: groups D, E.

### Phase 3. Variants, option matrix and pricing UX
* `OptionMatrix`: choose axes, build combinations client-side, map each row to a POS SKU code, validate duplicates, create variants via the existing route (batched, idempotent). POS picker only if `capabilities().listSkus`.
* Per-variant images (uses `variant_id`), price history drawer, discount preview; pricing remains `pricing.write`.
* Optional migration `0009` (partial unique index on active option sets) after the read-only duplicate check.
* Exit: group F.

### Phase 4. Content generation, field modes and slug management
* Migration `0007`: `content_field_states`, `content_suggestions`, `content_templates`.
* `ContentGenerator` port, `TemplateGenerator`, fact builder, output guard, suggestion endpoints, `ModeField` and `SuggestionDiff` in the editor, description templates screen.
* Slug auto mode (draft only), redirects on published slug change, storefront 301.
* Exit: groups G, H.

### Phase 5. Media upload (blocked on O2)
* `MediaStore` port with `LocalDiskMediaStore` and `UnconfiguredMediaStore`; migration `0008`; upload/finalize routes; validation and re-encoding; gallery upload UI; `next.config` image host tightening; cleanup job.
* Real provider adapter in a **separate approved PR** with provider credentials supplied by the owner outside the repo.
* Exit: group I.

### Phase 6. Preview, readiness and publishing gates
* `GET .../readiness` shared by UI and publish route; signed draft preview token; SERP/share previews finalised; bulk "fill empty fields" suggestions.
* Exit: group J.

### Phase 7. Hardening and release readiness
* Browser E2E smoke (local script, then CI if approved), accessibility pass (keyboard, labels, contrast), performance pass on the product list (sort, image/price columns, indexes), docs refresh (`ADMIN.md`, `SECURITY.md`, `DATABASE.md`, `ER_DIAGRAM.md`, `OPERATIONS.md`), decision records in `DECISIONS.md`.
* Staging deploy and any production migration are **separate approvals**.

## 4. Dependencies and order

```
Phase 0 → Phase 1 → Phase 2 → Phase 3
                  ↘            ↘
                   Phase 4 (needs 1 for versioning, 2 for facts/types)
Phase 5 needs: O2 and Phase 1 (media routes)   → Phase 6 needs 2,4,5 (5 optional)
Phase 7 last
```
Phases 3 and 4 can run in parallel after Phase 2 (different files: variants vs content tables). Phase 1's SEO correctness fixes have no dependency and should land first.

## 5. API and database change register

| Change | Phase | Migration |
| --- | --- | --- |
| `products.version`, `slug_redirects` | 1 | 0005 |
| Media PATCH/reorder routes | 1 | none |
| Product types, template, groups, tags, definition columns, `product_type_id`, `variant_axes` | 2 | 0006 |
| Variant uniqueness index | 3 | 0009 (conditional) |
| Content state, suggestions, templates | 4 | 0007 |
| Media columns, `media_uploads` | 5 | 0008 |

(Numbers are assigned in merge order; if phases ship in a different order the file numbers change, content does not.)

## 6. Security and permissions checklist (applies to every phase)

Store id only from the path; composite `(store_id, id)` FKs for every new child table; cross-store id injection tests; `defineRoute` permission on every route; audit in the same transaction; no `.default()` in `PATCH` schemas; rate limits on generation and upload; plain-text sanitising of suggestions; no secrets, tokens or provider keys in the repo or logs; the repository is public.

## 7. Testing strategy (all phases)

Vitest API tests on a disposable `_test` database (never a shared or production database); each migration applied twice and against a populated copy; permission matrix tests per role; admin component and pure-function tests; storefront head/JSON-LD tests; extended `e2e-roles.mjs`; new browser smoke. CI continues to run typecheck, tests, build and the OpenAPI drift check; the browser smoke is added only with owner approval. Run order before every merge: typecheck → API tests twice → admin/web tests → build.

## 8. Deployment dependencies and rollback

* Nothing in Phases 0-4 needs new infrastructure. Phase 5 needs storage/CDN (O2). Production use of any phase additionally needs: a working staging environment (does not exist), the `TRUST_PROXY` topology verification, and the existing "before first production deploy" list in `docs/DEPLOYMENT.md`.
* Migrations are additive; rollback = redeploy the previous image, which ignores new nullable columns and tables. Dropping new objects is a separate approved step after the previous release is retired. Feature flags: `MEDIA_STORE` (default unconfigured), `CONTENT_GENERATOR` (default `template`).
* If a migration fails on a populated copy, the phase does not merge.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Scope is large; editor rewrite could regress working product creation | Phase 1 keeps the old form functionality; ship cards incrementally; keep routes backward compatible |
| Existing data may violate new constraints (duplicate option sets, odd slugs) | Read-only checks on a copy before any constraint; constraints optional where data is dirty |
| Select-option renames orphan stored values | Rename operation rewrites values transactionally; validation on read in the admin shows invalid values |
| Generated text sounds generic or leaks wrong claims | Template + output guard, preview/accept, insufficient-data state, no auto-overwrite |
| Unknown stock misread as availability | Tri-state, omit availability, tests |
| Hot-linked images / wildcard image optimizer | Inventory, tighten hosts, uploads (Phase 5) |
| No staging, no browser E2E in CI | O10; local smoke in the meantime |
| POS contract unverified | Editor never assumes POS features; `listSkus` picker only when the capability is reported |
| Public repository | No secrets/credentials/merchant data in code, fixtures or docs |

## 10. Second-review release strategy (supersedes phase ordering above where they differ)

The original Phase 1 mixed independent fixes with a migration. It is split so the safest, most valuable changes can ship alone.

| Release | Content | Migration | Depends on | Can ship alone |
| --- | --- | --- | --- | --- |
| **R1 (Phase 1a): SEO correctness** | Canonical, `noindex` handling, OG/Twitter from the resolved SEO, breadcrumb and product JSON-LD, unknown-stock availability fix, sitemap eligibility and `lastmod`, meta-description algorithm, `stock` tri-state field on the storefront product response | **None** (`SeoMeta` is jsonb; `updated_at` exists) | Nothing | **Yes.** API first (additive response fields), then web; web must tolerate the field missing during rollout |
| **R2 (Phase 1b): image-host hardening** | `MEDIA_ALLOWED_HOSTS`, shared URL validator, write-time rejection on media/logo/favicon/content routes, generated `remotePatterns`, resource limits, `unoptimized` for unlisted hosts | None (config + code) | Read-only host inventory on a copy; owner confirms the legacy host list | **Yes**, independent of R1. Behaviour change: URLs on unlisted hosts are rejected for new writes; existing rows keep working through `unoptimized` |
| **R3 (Phase 1c): versioning + editor shell** | Migration `0005` (`version` on products and variants, `slug_redirects` empty), required `expectedVersion`, conflict UX, media PATCH/reorder, SEO/specification/attribute-value/collection cards on existing definitions | `0005` | R1 not required; admin and API deploy together | No: admin and API must be released together (old admin gets 428) |
| R4 (Phase 2) | Product types, templates, tags, constraints | `0006` | R3 | After R3 |
| R5 (Phase 3) | Option matrix, variant media, optional duplicate-options index | `0009` (conditional) | R4 | After R4 |
| R6 (Phase 4) | Field states, suggestions, templates, slug redirects live | `0007` | R3, R4 | After R4 |
| R7 (Phase 5) | Media upload | `0008` | Owner storage decision; R2; hardened fetch design if legacy import is wanted | After decision |
| R8 (Phase 6-7) | Readiness, preview, hardening, E2E | none | R3-R6 | Last |

Migration dependency chain (file numbers follow merge order, not planning order): `0005` → `0006` → `0007`; `0008` depends only on `0005`; `0009` depends on `0006` and a clean duplicate check. No migration depends on an application release other than "the previous image ignores new objects".

### 10.1 Deployment and operations prerequisites (not currently satisfied)

Per `docs/DEPLOYMENT.md` nothing is deployed and no hosting, domain, TLS, database provider or staging exists. **This plan therefore does not assume production deployment is possible.** Development, review and CI can proceed on local and disposable databases; the following are release gates for any real environment:

1. A staging environment that mirrors production topology (including the proxy path and `TRUST_PROXY` values) and uses a restored copy of data, never live data.
2. Managed PostgreSQL with automated backups and a **restore test** performed once before the first migration of this work.
3. For each migration: fresh backup; rehearsal on a restored copy (apply, run the API suite against it, time it); apply twice for idempotency; written rollback note; owner approval for production (CLAUDE.md rule 8).
4. Rollback model: migrations are additive, so rollback is redeploying the previous image. Two exceptions need care: R3 (a previous *admin* build does not send `expectedVersion`, but the previous *API* ignores the field, so rolling back both together is safe; rolling back only the API is also safe; rolling back only the admin while the new API stays gives 428 errors, so they roll back as a pair) and R2 (rolling back re-enables the wildcard; a documented, deliberate step).
5. Egress filtering for the storefront server (MEDIA_ARCHITECTURE 7.2(6)), edge rate limit for `/_next/image`, and the `TRUST_PROXY` checklist.
6. Feature flags/config with safe defaults: `MEDIA_STORE=unconfigured`, `CONTENT_GENERATOR=template`, `MEDIA_ALLOWED_HOSTS` required in production (startup refuses an empty list once R2 ships).
7. Monitoring for the new surfaces (image optimizer error rate and latency, 409/428 rates, suggestion failures) once an observability stack exists (none is chosen).
8. Scheduler for suggestion expiry and quarantine cleanup (no scheduler exists; lazy expiry is the required fallback).

> The authoritative decision list (IDs DR-01 to DR-11, engineering decisions ED-01 to ED-13) is [DECISION_REGISTER.md](DECISION_REGISTER.md); it supersedes section 2 where they differ.
