-- Shipping dashboard multi-container slots.
-- Safe migration: preserves all existing records and marks historical rows as 第1柜.

alter table public.records
  add column if not exists container_no int not null default 1;

alter table public.records
  drop constraint if exists records_container_no_range;

alter table public.records
  add constraint records_container_no_range
  check (container_no between 1 and 20);

create index if not exists idx_records_week_container_slot
  on public.records (week_number, container, container_no);
