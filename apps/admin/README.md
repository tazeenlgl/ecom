# Admin dashboard (`apps/admin`)

Next.js 15 (App Router) admin for platform and store administrators, on port 3001. It uses only the existing `/v1/admin/*` API. Full documentation, security design, endpoint-to-screen map and known gaps: [docs/ADMIN.md](../../docs/ADMIN.md).

```sh
cp apps/admin/.env.example apps/admin/.env.local   # ADMIN_API_URL
npm run dev -w @ecom/admin                          # http://localhost:3001
```

Layout: `app/(app)/` holds the signed-in screens (`platform/*` for platform scope, `s/[storeId]/*` for a store), `app/api/auth/*` the login and logout routes, `app/api/admin/[...path]` the token-attaching proxy, `lib/` the CSRF rules, permission mirror and API clients, `components/` the shell and UI kit, `test/` the unit tests and the role/CSRF end-to-end script.
