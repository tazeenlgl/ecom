# Decision register

Status: **proposal; no decision below has been taken.** Second architecture review, baseline `main` `e03b827`. "Owner approval" = the project owner must approve before the dependent work starts (CLAUDE.md: nothing is deployed; no production deployment, production migration or live provider is authorized). Engineering decisions are listed too so nothing is decided silently; they proceed unless the owner objects.

## Part 1. Decisions that require owner approval

| ID | Question | Choices | Recommended | Consequence | Owner approval |
| --- | --- | --- | --- | --- | --- |
| DR-01 | May the SEO correctness fixes (release R1) be implemented first, on their own? | (a) Yes, R1 alone, no migration. (b) Fold into the editor release. (c) Defer | **(a)** | Fixes the unknown-stock `OutOfStock` claim, ignored `noIndex`/`canonicalUrl`, missing canonical/Twitter/breadcrumb, wrong `lastmod`. API response gains additive fields; storefront behaviour in search results changes (canonical tags and sitemap membership). Small, reversible by redeploy | **Yes** (to start implementation) |
| DR-02 | May new image URLs be restricted to an allow-list (R2), replacing the wildcard? | (a) Allow-list + `unoptimized` for unlisted legacy hosts. (b) Allow-list + own hardened proxy. (c) Keep wildcard, rate-limit only. (d) Upgrade Next.js if a release gives redirect/IP controls (not verified) | **(a) now; (b) if redirect-following from allowed hosts must be blocked before uploads exist; (d) only after a verified release and a regression run** | Closes the public open-proxy/SSRF surface. Staff can no longer paste arbitrary image hosts; an administrator maintains `MEDIA_ALLOWED_HOSTS`. Existing images on unlisted hosts still show (unoptimized, loaded directly by the browser) | **Yes** (behaviour change for staff, and the legacy-host list from a read-only inventory needs your review) |
| DR-03 | Is `expectedVersion` required on every mutating product/variant call from its first release? | (a) Required immediately. (b) Optional for a release, then required. (c) Never required | **(a)** | No silent last-write-wins. Admin and API must be released and rolled back together (stale admin build gets 428 and reloads). If a non-admin client of these routes exists, it breaks; none is known | **Yes** |
| DR-04 | Adopt the data-model direction: new store-scoped `product_types` + template join table, `attribute_groups`, `product_tags`, field-state and suggestion tables, `version` columns, additive migrations `0005`-`0009` | (a) As designed. (b) Template stored as JSON on a single type row. (c) No product types; extend attribute definitions only | **(a)** | Enables required/ordered/grouped attributes per type for any category. Adds tables and ~5 migrations (rehearsed on copies; none run on production without separate approval). (b) is simpler but blocks referential integrity and usage checks; (c) cannot express different requirements per type | **Yes** |
| DR-05 | Which object storage/CDN, if any, for uploads? | (a) S3-compatible hyperscaler + CDN. (b) R2-style S3-compatible with bundled CDN. (c) Self-hosted object store. (d) Managed image platform. (e) Stay on external URLs | **Unresolved by design.** Decide after R1-R3; inputs needed: region/residency requirement, budget, volume, who holds credentials, media domain plan | Blocks release R7 (uploads) only. The `MediaStore` port, local-disk adapter and "unconfigured" default let development proceed. Quotes needed; no prices were verified | **Yes** (not needed now) |
| DR-06 | Allow a model-backed content generator in the future? | (a) No: deterministic template generator only. (b) Later, with an approved provider, cost cap, data-processing review and secret store | **(a) for this release**; revisit only on request | With (a) no product data leaves the system and no credential exists. Text quality is templated, not creative. (b) needs its own review and PR | **Yes** to confirm (a); (b) would need separate approval |
| DR-07 | May a published product's slug be edited? | (a) Editable, old URL 301-redirects. (b) Locked after first publish | **(a)** | Preserves SEO value of old links; adds the `slug_redirects` lookup on every product 404 path. (b) is simpler but forces archive-and-recreate for a typo | **Yes** |
| DR-08 | Which readiness items block publishing? | (a) Today's rule only (active priced variant) + required template attributes. (b) Also require an image. (c) Also HSN and a category | **(a) blocking; image, alt text, HSN, category advisory** | (b)/(c) reduce incomplete listings but block fast launches and need per-store settings; HSN/GST obligations are a tax owner's call (invoicing owner is still undecided per `ecom-context.md`) | **Yes** (HSN/GST especially) |
| DR-09 | Permission model for configuration screens | (a) Reuse `catalogue.write`. (b) New `catalogue.configure` for types, attributes, templates, allowed hosts | **(a) now** | (a) lets any catalogue editor change the shared templates that shape every product; (b) changes the role table and needs a role-migration note | **Yes** |
| DR-10 | Staging and recovery prerequisites before any real use | (a) Build staging + managed Postgres backup/restore test first. (b) Proceed in dev/CI only; defer environments | **(b) now, (a) before the first real deploy** | Implementation and review can go on locally. Nothing in this plan can be released to customers until hosting, staging and a tested restore exist (`docs/DEPLOYMENT.md`) | **Yes** (hosting/budget decisions are yours; not needed to start R1-R3) |
| DR-11 | Production deployment and production migrations | n/a | **Not requested; remain unauthorized** | Stated so it is not assumed | Already withheld; any change needs a new explicit approval |

## Part 2. Engineering decisions (proceed unless the owner objects)

| ID | Question | Choices | Recommended | Consequence | Approval |
| --- | --- | --- | --- | --- | --- |
| ED-01 | Where is SEO metadata resolved? | API (pure function) / web | **API**, web only renders | One tested implementation; additive response fields | No |
| ED-02 | Unknown stock representation | boolean `inStock` / tri-state `stock` | **Tri-state `stock`**, keep `inStock` for compatibility | JSON-LD never claims availability for unknown | No |
| ED-03 | Meta-description fallback | cut at 160 / whole sentences / omit | **Whole sentences ≤155, else attribute summary, else omit** | Some products have no meta description (search engines write their own) | No |
| ED-04 | Where do generation modes live | JSON on product / separate state tables | **Separate `content_field_states` + `content_suggestions`**; missing row = manual | Existing content stays manual; no backfill | No |
| ED-05 | Suggestion guards | value hash only / value hash + version | **Both** | Stale previews cannot overwrite anything | No |
| ED-06 | Select option storage | strings / `{value,label}` | **Strings + rename/merge operation** | Option renames stay safe; labels can't differ from values yet | No (revisit if multilingual) |
| ED-07 | Products without options | require axes / default variant | **One default variant mapped to a POS SKU** | Works for non-apparel items; still no minted SKUs | No |
| ED-08 | Variant combinations | persist unmapped rows / client-only until SKU entered | **Client-only until mapped** | No placeholder SKUs in the database | No |
| ED-09 | Version granularity | one version per product / product + variant | **Product + variant** | Price edits do not conflict with content edits | No |
| ED-10 | Suggestion expiry without a scheduler | job / lazy on read | **Lazy on read** (job later) | Works today | No |
| ED-11 | Video | include / exclude | **Excluded from this release** (as instructed) | `media_kind='video'` stays unused | Settled |
| ED-12 | Importing images from a URL on the server | allow / forbid | **Forbid** (uploads are browser bytes) | Removes the main server-side fetch of user URLs | No |
| ED-13 | Platform starter templates | shared rows / copy-on-create | **Copy-on-create** into each store | Tenants stay independent | No |

## Part 3. Final list of decisions that genuinely need your approval

**Needed to start the first implementation work (R1-R3):**
1. **DR-01**: implement the SEO correctness release (no migration) first.
2. **DR-02**: replace the wildcard image host rule with an allow-list (behaviour change for staff; also review the legacy-host list the read-only inventory will produce).
3. **DR-03**: require `expectedVersion` on every mutating product/variant call.
4. **DR-04**: approve the product-type/field-state data-model direction and the additive migration series (migrations are written and rehearsed on disposable databases only).

**Needed before the matching later release, not before starting:**
5. **DR-07**: slug editing after publish with redirects.
6. **DR-08**: publish blockers (especially HSN/GST).
7. **DR-09**: permission model for configuration screens.
8. **DR-06**: confirm "deterministic generator only".
9. **DR-05**: storage/CDN provider (only before uploads).
10. **DR-10**: staging, managed database and backup/restore (only before any real deployment).

**Not requested and not assumed:** production deployment, production migrations, live providers, a Next.js upgrade (becomes a decision only if DR-02 option (d) is chosen).
