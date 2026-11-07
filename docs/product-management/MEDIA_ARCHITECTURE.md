# Media architecture

Status: **proposal, nothing implemented, no provider selected, no credentials created.** Baseline `main` `e03b827`.

## 1. Current implementation (verified)

* `product_media` stores metadata only: `url` (https, ≤1000), `kind` (image/video), `alt_text`, `width`, `height`, `position`, optional `variant_id`. Comment in schema: files are "hosted elsewhere (object storage/CDN)"; **no storage layer exists**.
* Admin: "Add photo" takes an https URL; the card text says the API "does not upload files". There is **no update route** (alt text, order, variant link are fixed after creation) and no featured flag; the first photo by `position` is the listing image (`storefront-routes.ts:91`).
* Storefront images go through `next/image` with `remotePatterns: [{ protocol: 'https', hostname: '**' }]` (`apps/web/next.config.ts`), i.e. the image optimizer will fetch **any** https host. This is a server-side request surface, not only a cost risk; the second review (section 7) verified how the installed Next.js (15.5.29) behaves and found it exploitable without any admin access.
* Nothing checks that a URL is an image, its size, or that the host stays available. Hot-linked images can disappear or change after publication.

## 2. Requirements

Upload from the admin; validate type, size and dimensions; store durably; serve through a CDN with cache headers; gallery with featured image and reordering; variant-specific images; alt text with auto/manual control ([SEO_AND_CONTENT_GENERATION.md](SEO_AND_CONTENT_GENERATION.md)); safe deletion; works per tenant (store) without cross-store access; no secrets in the repository; local development and CI work without any cloud account.

## 3. Proposed architecture (provider-neutral)

```
Admin browser ──(1) POST /v1/admin/stores/:storeId/media/uploads {filename,size,contentType,productId}
        API ── validates permission/limits ── creates media_uploads row (pending) ── returns {uploadId, uploadUrl, headers, expiresAt}
Admin browser ──(2) PUT bytes to uploadUrl (direct to object storage; never through the API)
Admin browser ──(3) POST .../media/uploads/:uploadId/finalize
        API/worker ── reads object ── verifies size, magic bytes, decodes dimensions ── strips metadata ──
                      creates derivatives ── inserts product_media row ── marks upload complete
Storefront ── <img>/next-image ── CDN URL (public, immutable, content-hashed key)
```

### 3.1 Storage port

```
interface MediaStore {
  capabilities(): { signedUploadUrls: boolean; serverSideRead: boolean; publicBaseUrl: string };
  createUpload(key, { contentType, maxBytes, expiresInSec }): Promise<{ url; headers }>;
  head(key): Promise<{ size; contentType } | null>;
  get(key): Promise<ReadableStream>;           // for validation/derivatives
  put(key, bytes, contentType): Promise<void>; // derivatives
  delete(key): Promise<void>;
  publicUrl(key): string;
}
```
Adapters: `LocalDiskMediaStore` (development and CI, writes under a gitignored directory, served by the API or the web dev server) and `UnconfiguredMediaStore` (default; upload endpoints answer 501 `media_upload_unavailable`, the editor keeps the existing https-URL path). The real adapter is added only after the owner picks a provider (section 4). This mirrors `PosGateway`/`UnconfiguredPosGateway` and the "no live providers" rule.

### 3.2 Keys, tenancy and naming

`stores/{storeId}/products/{productId}/{mediaId}/{sha256-prefix}.{ext}` for originals; derivatives under `.../w{width}.{webp|avif}`. The `storeId` and `productId` are taken from the verified path and database, never from the filename. Content-hashed keys allow `Cache-Control: public, max-age=31536000, immutable`. Filenames supplied by the client are stored as `original_filename` metadata only and never used in a key or a response header.

### 3.3 Validation (server-side, authoritative)

| Check | Rule (proposed, adjustable) |
| --- | --- |
| Allowed types | JPEG, PNG, WebP; AVIF optional later. **SVG and GIF rejected** (script/animation risk for product photos) |
| Type verification | Sniff magic bytes; reject when they disagree with the declared `Content-Type`/extension |
| Size | ≤ 10 MB per image, ≤ 20 images per product, per-store daily upload cap |
| Dimensions | min 600 px longest side; max 8000 px per side and 40 megapixels (decompression-bomb guard) |
| Decode | Re-encode through a trusted image library (e.g. sharp/libvips) rather than serving the upload as is; strip EXIF/GPS and ICC unless needed |
| Malware | Not scanned in scope; re-encoding removes appended payloads. A scanner is a deployment decision |
| Rate limit | Per admin and per store on `uploads` and `finalize` |
| Idempotency | `Idempotency-Key` on create-upload and finalize (existing `defineRoute` support) |

Pre-signed URLs are single-object, `PUT` only, content-type and length-bound, expire in ≤ 10 minutes, and point at a **quarantine** prefix. Finalize copies the validated, re-encoded result to the public prefix, so an unvalidated byte is never publicly served. Orphaned quarantine objects are removed by a scheduled job (note: recurring jobs are not scheduled in the repo today, so this needs the scheduler item from `KNOWN_ISSUES.md`).

### 3.4 Data model (additive, migration `0008`)

```
product_media + columns:  storage_key text null, source ('external_url'|'upload') default 'external_url',
  content_type text null, byte_size int null, checksum_sha256 text null,
  original_filename text null, is_featured boolean default false,
  status ('ready'|'processing'|'failed') default 'ready', deleted_at null
media_uploads: id, store_id, product_id, uploaded_by, storage_key, declared_type, declared_size,
  status ('pending'|'finalized'|'rejected'|'expired'), reject_reason null, expires_at, created_at
```
Existing external-URL rows keep working unchanged (`source='external_url'`). `url` stays the render URL (CDN URL for uploads), so the storefront query and `next/image` need no change in the first release. A constraint ties `variant_id` to a variant of the same product (composite FK exists today).

### 3.5 Gallery behaviour

* **Featured image:** `is_featured` (exactly one per product, partial unique index); falls back to position 0.
* **Reordering:** `PUT /stores/:storeId/products/:id/media/order` with the full id list (validated to the product's own media, atomic, audited); the UI supports drag and keyboard buttons.
* **Variant-specific media:** `variant_id` set per image; the storefront shows the variant's images when it is selected and falls back to shared images. An image belongs to one variant or to the product.
* **Alt text:** `PATCH /stores/:storeId/media/:id`; auto/manual state per image row; empty alt allowed only when marked decorative.
* **Delete:** soft-delete (`deleted_at`), object removed after a grace period; blocked if it is the OG image of a published product unless replaced (or the OG image falls back).
* **Video:** the enum has `video` and the storefront treats only images in JSON-LD and listings. **Recommendation: out of scope for the first release.** Video needs transcoding, streaming/CDN costs, poster frames, captions/accessibility and larger limits; the benefit for a small apparel catalogue is unproven. Revisit with a hosted video provider after image upload is stable.

### 3.6 Image delivery and the optimizer

Superseded by section 7 (security design) and section 8 (portability). In short: no wildcard host, an explicit allow-list shared by the API validator and the storefront, and uploads served from a CDN host the owner controls. Width/height are stored so layout does not shift.

## 4. Storage and CDN options (no selection made)

| Option | For | Against | Notes |
| --- | --- | --- | --- |
| **S3-compatible bucket in an Indian region + CDN** (AWS S3 + CloudFront, or compatible) | Standard pre-signed PUT, mature, lifecycle rules, Mumbai/Hyderabad regions for latency and residency | Cost model (egress), IAM setup, one more vendor | Fits the port above directly |
| **Cloudflare R2 + Cloudflare CDN** | No egress fees, S3-compatible API, simple public bucket + custom domain | Data residency not India-pinned unless configured; dependence on Cloudflare account/DNS | Good cost profile for image-heavy storefronts |
| **Other S3-compatible Indian/regional host (e.g. self-hosted MinIO on the VPS)** | Data stays on infrastructure the owner controls, lowest recurring cost | You operate backups, availability, scaling and the CDN yourself; single VPS is a single point of failure | Reasonable for staging |
| **Managed image platform (e.g. Cloudinary, imgix)** | On-the-fly transforms, optimisation, upload widgets | Per-usage pricing, vendor lock-in of URLs, transforms leave less control over validation | Would replace derivatives step; URL scheme becomes provider-specific |
| **Keep external URLs only** | Zero work, zero cost | No validation, availability, or tenant isolation; hot-link risk; cannot guarantee alt/size; wildcard optimizer risk | Remains the fallback |

Decision inputs the owner must supply: hosting provider and region, budget, expected image volume (products × images × MB), CDN/domain plan (a media subdomain per brand or one shared), who holds the credentials. **No adapter, SDK, bucket or key is created until this is decided.** Because the `MediaStore` port and `LocalDiskMediaStore` exist, development and CI do not wait for the decision.

### 4.1 Comparison matrix (second review; no provider is selected)

Facts below are properties of the *kind* of service. Prices, exact regions and current terms were **not** looked up and must be confirmed with a quote before any choice; no figure here is a recommendation.

| Criterion | S3-compatible bucket + CDN (hyperscaler) | R2-style S3-compatible + same-vendor CDN | Self-hosted object store (MinIO/VPS) | Managed image platform | External URLs (today) |
| --- | --- | --- | --- | --- | --- |
| Direct browser upload (signed PUT) | Yes | Yes | Yes (S3 API) | Yes (vendor widget/API) | n/a |
| Indian region / residency | Available regions to confirm | Region pinning to confirm | Wherever the VPS is | Vendor-dependent | Unknown |
| CDN | Separate product, configured | Bundled with the vendor | You build it (or front with another CDN) | Bundled | Third party's |
| Egress / traffic cost model | Per-GB egress | Typically no egress fee (confirm) | VPS bandwidth allowance | Usage/transform based | None to us, but hot-link risk |
| Lifecycle (expire quarantine, tiering) | Yes | Yes | Manual / MinIO rules | Vendor | No |
| On-the-fly resizing | Needs extra service or our derivatives | Needs our derivatives or its image service | Our derivatives | Built in | Next optimizer (risky) |
| Ops burden | Low-medium | Low-medium | **High** (backups, HA, patching) | Low | None |
| Lock-in | Low if keys/URLs are ours (S3 API) | Low (S3 API) | None | **High** if URLs/transform syntax are used | n/a |
| Failure/availability risk | Provider SLA | Provider SLA | Single VPS | Provider SLA | Unbounded |
| Fits `MediaStore` port | Yes | Yes | Yes | Needs a different adapter shape | Already |

The S3-compatible rows share one adapter, which is why the port is defined in terms of keys, signed PUT and `publicUrl(key)` rather than any vendor SDK type.

## 5. Secrets, deployment and rollback

Storage credentials belong in the host's secret store and `.env` files that are never committed (repository is public). Bucket policy: no public listing, public read only on the `public/` prefix, quarantine private, CORS limited to the admin origin for `PUT`. Deployment dependencies: provider chosen and provisioned, DNS/TLS for the media host, `next.config` image hosts updated, scheduler for cleanup. Rollback: the feature is flagged by `MEDIA_STORE` (default unconfigured → 501); disabling it returns the editor to URL entry; uploaded objects and rows stay and remain served because the rows are ordinary `product_media`.

## 6. Testing

API tests with `LocalDiskMediaStore` or an in-memory store: valid upload happy path, wrong magic bytes, oversize, too many pixels, expired/foreign upload id, cross-store `productId`, replayed finalize (idempotent), reorder with foreign id (404), delete leaves OG fallback. Fixture images are generated in-test (no network). Admin component tests for the gallery (keyboard reorder, alt editing). No test touches a real cloud account.

## 7. Image optimizer and URL security (second review)

### 7.1 Verified behaviour of the installed Next.js 15.5.29 (read from `node_modules/next/dist`, not from documentation)

| Finding | Evidence | Consequence |
| --- | --- | --- |
| `/_next/image?url=<https URL>` is served by the storefront server and is **public and unauthenticated**. With `hostname: '**'` the allow-list check (`hasRemoteMatch`) passes for any host | `server/image-optimizer.js:577-640`, `next.config.ts` | Anyone on the internet can make the storefront server fetch any https URL (open image proxy), whether or not any product references it |
| The remote fetch is `fetch(href, { signal: AbortSignal.timeout(7000) })`: default redirect handling (**redirects are followed**), no `redirect: 'manual'` | `image-optimizer.js:899-902` | The allow-list is checked only on the first URL. An allowed (or any, with `**`) host can redirect to another host, including an `http://` internal address; the redirect target is never re-checked |
| There is **no private/loopback/link-local IP check** and no DNS pinning; the config keys `dangerouslyAllowLocalIP` and `maximumRedirects` do **not exist** in this version | `config-schema.js` has neither | SSRF to internal services and cloud metadata addresses, and DNS rebinding (a public name that later resolves to a private IP), are not blocked by Next here |
| Response body is capped by `maximumResponseBody` (default 50,000,000 bytes) and the request by a 7 s timeout | `image-config.js:61`, `image-optimizer.js:936` | Bounded per request but large: 50 MB × concurrent requests is a memory/bandwidth lever |
| SVG is refused (`dangerouslyAllowSVG: false`); output is served with `Content-Disposition: attachment` and a restrictive CSP | `image-config.js:62-64` | Script-in-image risk is mitigated; keep these defaults |
| Disk cache has **no size limit** by default (`maximumDiskCacheSize: undefined`); cache key includes the arbitrary URL | `image-config.js:60`, `image-optimizer.js:731` | Disk exhaustion by requesting many distinct URLs |
| Non-image upstream bodies are rejected after fetch (content sniffing) | `image-optimizer.js` (content-type detection) | Limits data exfiltration, but the *request* (a GET with side effects or a port scan by timing/status) has already been made: blind SSRF remains |
| Whether a pattern without `port` accepts non-default ports was not verified | not tested | A security test must pin this behaviour (7.5) |

Other places that accept an arbitrary https URL with no host policy: product media (`admin-routes.ts:524`), store logo and favicon (`platform/settings.ts:4-11`), content-block images (`content/routes.ts:14`), SEO `canonicalUrl` (`route.ts:169`, any scheme `z.url()`). `og:image` and JSON-LD images also publish whatever URL is stored.

Threats: **SSRF** (internal service, metadata endpoint, localhost admin/API ports via redirect to `http://`), **redirect-based bypass**, **DNS rebinding**, **resource exhaustion** (CPU in sharp for large dimensions, memory via 50 MB bodies, disk cache growth, upstream slow-loris within 7 s), **abuse as a free image proxy/bandwidth** and **content injection** (hostile image content, tracking pixels in stored URLs). No exploit was run; this is analysis of the code path.

### 7.2 Required design (all independent of which storage provider is chosen)

1. **One host allow-list, one source of truth.** `MEDIA_ALLOWED_HOSTS` (exact hostnames; a leading `*.` allowed only for a single label under a domain the owner controls). The same list is read by the API validator and by `next.config.ts` (`remotePatterns` generated from it at build/start). No `**`. Includes the approved CDN host(s) and, temporarily, the legacy hosts found in the read-only inventory of existing `product_media.url` values.
2. **URL validation at write time** (API; shared pure function with the storefront): https only; no userinfo (`user:pass@`); no IP literals in any form (IPv4 dotted/decimal/octal/hex, IPv6, IPv4-mapped); no `localhost`, `.local`, `.internal`, single-label hosts or trailing-dot tricks; hostname lower-cased and punycode-normalised before comparison; port empty or 443; no fragment; max 1000 chars; path length and character set limits; reject on any parse ambiguity (backslashes, control characters, mixed encodings).
3. **Redirect policy:** the optimizer must not follow redirects off the allow-list. Next 15.5.29 cannot enforce this. Options, in order of preference: (a) serve only uploaded media from a CDN host that never redirects, and mark all other hosts `unoptimized` so browsers fetch them directly and the server never does; (b) place a small hardened image proxy (own code, `redirect: 'manual'`, per-hop allow-list check, IP check on the resolved address, byte/time limits) in front of the optimizer; (c) upgrade Next.js to a release that provides redirect and local-IP controls (**not verified** that such a release exists; an upgrade is a dependency change needing approval and a full regression run).
4. **DNS rebinding:** by restricting to *named trusted hosts* we remove arbitrary names. Residual risk (a trusted host's DNS being changed) is accepted. If an own proxy is built, resolve once, check the address against private/loopback/link-local/metadata ranges (IPv4 and IPv6), and connect to that address.
5. **Resource limits:** `maximumResponseBody` lowered (proposed 10 MB, matching the upload cap), `minimumCacheTTL` set, `maximumDiskCacheSize` set, `deviceSizes`/`imageSizes`/`qualities` kept to a short list, `formats` limited to what the CPU budget allows (AVIF is costly), a rate limit and concurrency cap on `/_next/image` at the edge proxy, and an upstream timeout shorter than 7 s if configurable.
6. **Network egress control (deployment requirement):** the storefront server's outbound traffic must be firewalled from private ranges, the host's own services (including the API's port) and the cloud metadata address, so SSRF cannot reach them even if application checks fail. This cannot be verified in the repository; topology is unknown.
7. **No server-side "import from URL" feature.** The server never fetches an admin-supplied URL for storage. Uploads are bytes from the browser.
8. **SEO output:** `og:image` and JSON-LD images are emitted only for allow-listed hosts.
9. **Existing data:** a one-off *read-only* inventory (run on a copy) lists distinct hosts in `product_media.url`, store logo/favicon, and content blocks, to build the temporary allow-list and to size the migration to uploads.

### 7.3 Interim mitigation that needs no provider decision

Replace `hostname: '**'` with the inventory-derived list now (Phase 1b below), set the resource limits in 7.2(5), and render any image whose host is not on the list `unoptimized`. This closes the public open-proxy behaviour without storage work. Redirect-following from allowed hosts remains until 7.2(3) is done; the inventory should record whether each allowed host redirects.

### 7.4 Upload security (adds to 3.3)

* Upload keys are generated by the server (`stores/{storeId}/products/{productId}/{mediaId}/…`); the client supplies bytes and a declared type only. The pre-signed request is bound to the key, `Content-Type` and `Content-Length` range; expiry ≤ 10 minutes; single use.
* Quarantine bucket/prefix is private; nothing in it is ever served. Finalize reads the object, checks size and magic bytes, decodes with pixel limit (e.g. 40 MP and 8000 px side), re-encodes, strips metadata, writes derivatives to the public prefix, and only then inserts `product_media`.
* Per-admin and per-store rate limits and daily byte quota; audit rows for upload finalize and delete (not for each rejected attempt, which are counted in metrics).
* CORS on the bucket allows `PUT` only from the admin origin(s). Public prefix allows `GET`/`HEAD` only, no listing.
* Optional malware scanning is a deployment decision (re-encoding already discards appended payloads).
* No SVG, GIF or video. **Video is explicitly excluded from this release**; the `media_kind` enum value `video` stays unused by the editor and the storefront keeps ignoring it.

### 7.5 Security tests

| Test | Level | Expected |
| --- | --- | --- |
| URL validator table: `https://user:pw@cdn.example/x`, `https://127.0.0.1/a`, `https://2130706433/a`, `https://0x7f.1/a`, `https://[::1]/a`, `https://[::ffff:127.0.0.1]/a`, `https://localhost/a`, `https://cdn.example./a`, `https://CDN.EXAMPLE/a`, `https://cdn.example:8443/a`, `https://cdn.example\@evil/a`, punycode look-alike, 1001-char URL, control characters | U | Rejected, except the correctly normalised allowed form |
| Media/logo/content routes with a non-allow-listed host | A | 400, nothing stored; cross-store ids unaffected |
| `next.config` generated `remotePatterns` equals `MEDIA_ALLOWED_HOSTS`; contains no `**` | U | Pass |
| Request `/_next/image?url=` for a non-allow-listed host, an IP literal, a `//` protocol-relative URL and a recursive `/_next/image` URL | S (local `next start`, loopback fixture servers only) | 400, no upstream request received by the fixture |
| Allowed fixture host that answers 302 to a disallowed or `http://` target | S | Not followed (400/502). **Expected to fail on Next 15.5.29 without 7.2(3)**; the test documents the gap and gates Phase 5 acceptance |
| Port behaviour of `remotePatterns` without `port` | S | Pinned by test, whichever way Next behaves |
| Fixture returns more than the byte cap, or trickles bytes past the timeout, or returns a non-image or SVG | S | 413 / 504 / 400; connection closed; nothing cached |
| Thousands of distinct URLs against a size-capped disk cache | S | Cache stays under the cap |
| Decompression bomb image (small file, huge dimensions) | A (upload finalize) and S | Rejected before full decode |
| Upload: wrong magic vs declared type, oversize, expired or foreign upload id, key traversal in filename, replayed finalize | A | Rejected / idempotent |
| `og:image` and JSON-LD for a non-allow-listed stored URL | S | Omitted |

All fixtures are local loopback servers started by the test; no external network is used.

## 8. Portability and migration between providers

* Uploaded rows store `storage_key` (provider-neutral) and the **public URL is derived** from `MEDIA_PUBLIC_BASE_URL + key` at read time; `product_media.url` is persisted only for `source='external_url'`. Switching provider is then: copy objects by key, change the base URL and adapter configuration, verify counts and checksums (`checksum_sha256` is stored), keep the old bucket until caches expire.
* Keys contain no provider names, regions or vendor tokens. Content-hashed names make copies idempotent and CDN invalidation unnecessary.
* The CDN host can be the owner's own subdomain (CNAME) so that URLs in search results, `og:image` and JSON-LD survive a provider change. This is a strong reason to prefer a media subdomain per brand or one shared media domain.
* Migrating the *legacy external URLs* into storage (optional, later) is an admin-triggered job that downloads from allow-listed legacy hosts with the hardened fetcher of 7.2(3), validates as an upload, and swaps the row to `source='upload'`; failures leave the row untouched.
* Export: a read-only job can list `storage_key`, checksum and size for backup verification.
