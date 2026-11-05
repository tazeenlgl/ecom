-- LOCAL DEVELOPMENT ONLY. Never run against staging or production.
-- Creates a demo store on host "demo.localhost" with a few products, stock,
-- a delivery zone and homepage content so the storefront can be clicked through.
-- Stock rows stand in for the POS until a real adapter exists.
-- Usage: psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f apps/web/scripts/demo-store.sql
-- Safe to re-run: every insert skips rows that already exist.
begin;

-- Safety guard: refuse to run on a database that already has a real (non-.localhost)
-- verified domain, i.e. anything that looks like staging or production.
do $$
begin
  if exists (select 1 from store_domains where verified_at is not null and hostname not like '%.localhost') then
    raise exception 'demo-store.sql is for local development only: this database has real verified domains';
  end if;
end $$;

insert into brands (slug, name) values ('demo', 'Demo Brand') on conflict do nothing;

insert into stores (brand_id, slug, name, public_settings, config, pos_location_ref)
select id, 'demo', 'Maison Demo',
  '{"announcement":"Free shipping on orders above ₹1,999","seo":{"defaultDescription":"Considered essentials, made to last."},"contact":{"email":"hello@example.com"}}',
  '{"codEnabled":true}', 'DEMO-01'
from brands where slug = 'demo'
on conflict do nothing;

insert into store_domains (store_id, hostname, is_primary, verified_at)
select id, 'demo.localhost', true, now() from stores where slug = 'demo'
on conflict do nothing;

with s as (select id from stores where slug = 'demo')
insert into categories (store_id, slug, name, description, position)
select s.id, c.slug, c.name, c.descr, c.pos from s,
  (values ('shirts', 'Shirts', 'Breathable cottons and linens.', 1), ('trousers', 'Trousers', 'Tailored and relaxed fits.', 2)) as c(slug, name, descr, pos)
on conflict do nothing;

with s as (select id from stores where slug = 'demo')
insert into products (store_id, slug, title, description, status, published_at, tax_rate_bps, attributes)
select s.id, p.slug, p.title, p.descr, 'published', now(), 500, '{}'::jsonb from s,
  (values
    ('linen-shirt', 'Linen Camp Shirt', E'A relaxed camp-collar shirt in washed linen.\n\n- 100% linen\n- Relaxed fit\n- Coconut shell buttons'),
    ('oxford-shirt', 'Oxford Button-Down', 'Our everyday oxford in a soft, brushed cotton.'),
    ('pleated-trouser', 'Pleated Wide Trouser', 'High-rise, single-pleat trousers with a fluid drape.')
  ) as p(slug, title, descr)
on conflict do nothing;

insert into product_categories (store_id, product_id, category_id)
select p.store_id, p.id, c.id from products p
join categories c on c.store_id = p.store_id and c.slug = case when p.slug like '%shirt' then 'shirts' else 'trousers' end
where p.store_id = (select id from stores where slug = 'demo')
on conflict do nothing;

insert into product_variants (store_id, product_id, sku_code, title, options, position)
select p.store_id, p.id, upper(replace(p.slug, '-', '')) || '-' || sz, sz, jsonb_build_object('size', sz), ord
from products p, (values ('S', 1), ('M', 2), ('L', 3)) as v(sz, ord)
where p.store_id = (select id from stores where slug = 'demo')
on conflict do nothing;

insert into variant_prices (store_id, variant_id, mrp_paise, price_paise)
select v.store_id, v.id, 349900, case when v.sku_code like 'LINEN%' then 279900 else 249900 end
from product_variants v where v.store_id = (select id from stores where slug = 'demo')
on conflict do nothing;

insert into pos_stock_levels (sku_code, location_ref, available)
select v.sku_code, 'DEMO-01', case when v.title = 'L' and v.sku_code like 'OXFORD%' then 0 else 12 end
from product_variants v where v.store_id = (select id from stores where slug = 'demo')
on conflict do nothing;

insert into shipping_zones (store_id, name, pincode_prefixes, charge_paise, free_above_paise, cod_available, cod_fee_paise, estimated_days_min, estimated_days_max)
select id, 'All India', array['1','2','3','4','5','6','7','8'], 9900, 199900, true, 4900, 3, 6 from stores
where slug = 'demo' and not exists (select 1 from shipping_zones z join stores s on s.id = z.store_id where s.slug = 'demo' and z.name = 'All India');

insert into content_blocks (store_id, kind, key, data, status, position)
select id, k.kind::content_block_kind, k.key, k.data::jsonb, 'published', k.pos from stores, (values
  ('navigation', 'main', '{"items":[{"label":"Shop all","href":"/shop"},{"label":"Shirts","href":"/c/shirts","children":[{"label":"Linen","href":"/c/shirts"},{"label":"Oxford","href":"/c/shirts"}]},{"label":"Trousers","href":"/c/trousers"}]}', 0),
  ('homepage_section', 'hero', '{"layout":"hero","heading":"Made for warm days","body":"Linen, cotton and easy tailoring for the season ahead.","link":{"label":"Shop the collection","href":"/shop"}}', 1),
  ('homepage_section', 'new', '{"layout":"product_grid","heading":"New arrivals","productLimit":8}', 2),
  ('homepage_section', 'cats', '{"layout":"category_grid","heading":"Shop by category"}', 3),
  ('homepage_section', 'story', '{"layout":"rich_text","heading":"Fewer, better things","body":"Every piece is cut from natural fibres and finished by hand."}', 4)
) as k(kind, key, data, pos)
where stores.slug = 'demo'
on conflict do nothing;

commit;
