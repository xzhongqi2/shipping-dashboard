-- ════════════════════════════════════════════
-- DDP shipments 表
-- ════════════════════════════════════════════

create table if not exists public.shipments (
  id            uuid primary key default gen_random_uuid(),
  booking       text,
  container     text,
  shipper       text,
  consignee     text,
  origin_port   text,
  dest_port     text,
  goods         text,
  ctns          numeric default 0,
  volume        numeric default 0,
  weight        numeric default 0,
  dept          text,
  details       jsonb not null default '{}'::jsonb,
  nodes         jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_shipments_created on public.shipments(created_at desc);
create index if not exists idx_shipments_container on public.shipments(container);

drop trigger if exists trg_shipments_audit on public.shipments;
create trigger trg_shipments_audit
  before insert or update on public.shipments
  for each row execute function public.set_audit_fields();

alter table public.shipments enable row level security;

drop policy if exists "staff full access shipments" on public.shipments;
create policy "staff full access shipments" on public.shipments
  for all to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'staff')
  with check (auth.jwt()->'app_metadata'->>'role' = 'staff');

drop policy if exists "viewer read shipments" on public.shipments;
create policy "viewer read shipments" on public.shipments
  for select to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'viewer');
