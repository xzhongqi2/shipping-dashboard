-- Shipping dashboard content center.
-- Run this in Supabase SQL Editor before using 最新船期 / 本周报价 uploads.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('shipping_content', 'shipping_content', false)
on conflict (id) do nothing;

create table if not exists public.shipping_content_items (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('schedule', 'quotes')),
  title text not null,
  file_name text not null,
  file_type text not null check (file_type in ('excel', 'image')),
  content_type text,
  storage_path text not null unique,
  preview jsonb,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_shipping_content_items_type_created
  on public.shipping_content_items (type, created_at desc);

create or replace function public.set_shipping_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_shipping_content_items_updated_at on public.shipping_content_items;
create trigger trg_shipping_content_items_updated_at
before update on public.shipping_content_items
for each row execute function public.set_shipping_content_updated_at();

alter table public.shipping_content_items enable row level security;

drop policy if exists "content read by authorized roles" on public.shipping_content_items;
drop policy if exists "content write by upload roles" on public.shipping_content_items;

create policy "content read by authorized roles"
on public.shipping_content_items
for select
to authenticated
using ((auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator', 'viewer'));

create policy "content write by upload roles"
on public.shipping_content_items
for all
to authenticated
using ((auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator'))
with check ((auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator'));

drop policy if exists "shipping content objects read by authorized roles" on storage.objects;
drop policy if exists "shipping content objects insert by upload roles" on storage.objects;
drop policy if exists "shipping content objects update by upload roles" on storage.objects;
drop policy if exists "shipping content objects delete by upload roles" on storage.objects;

create policy "shipping content objects read by authorized roles"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'shipping_content'
  and (auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator', 'viewer')
);

create policy "shipping content objects insert by upload roles"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'shipping_content'
  and (auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator')
);

create policy "shipping content objects update by upload roles"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'shipping_content'
  and (auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator')
)
with check (
  bucket_id = 'shipping_content'
  and (auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator')
);

create policy "shipping content objects delete by upload roles"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'shipping_content'
  and (auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator')
);
