-- Brand Anything extends the laptop campaign ledger without changing its
-- concurrency-sensitive creation and bidding functions. Asset metadata is
-- attached idempotently after the campaign transaction; older campaigns fall
-- back to the laptop presentation when no asset row exists.

create table public.ba_dev_campaign_assets (
  laptop_id uuid primary key references public.ba_dev_laptops(id) on delete cascade,
  asset_type text not null check (asset_type in ('laptop', 'anything')),
  asset_name text not null check (char_length(asset_name) between 2 and 80),
  model_storage_path text,
  model_file_name text,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (asset_type = 'laptop' and model_storage_path is null and model_file_name is null)
    or
    (asset_type = 'anything'
      and model_storage_path is not null
      and model_file_name is not null
      and model_storage_path ~ '^[a-f0-9]{16}/[a-f0-9-]{36}-[a-zA-Z0-9_-]+\.glb$'
      and lower(model_file_name) like '%.glb')
  )
);

create table public.ba_prod_campaign_assets (
  like public.ba_dev_campaign_assets including all,
  constraint ba_prod_campaign_assets_laptop_id_fkey
    foreign key (laptop_id) references public.ba_prod_laptops(id) on delete cascade
);

alter table public.ba_dev_campaign_assets enable row level security;
alter table public.ba_prod_campaign_assets enable row level security;

revoke all on table public.ba_dev_campaign_assets from anon, authenticated;
revoke all on table public.ba_prod_campaign_assets from anon, authenticated;
grant select, insert on table public.ba_dev_campaign_assets to service_role;
grant select, insert on table public.ba_prod_campaign_assets to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'ba_dev_brand_models',
    'ba_dev_brand_models',
    false,
    26214400,
    array['model/gltf-binary', 'application/octet-stream']
  ),
  (
    'ba_prod_brand_models',
    'ba_prod_brand_models',
    false,
    26214400,
    array['model/gltf-binary', 'application/octet-stream']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
