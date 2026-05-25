-- ════════════════════════════════════════════
-- shipping records: 审计字段 + RLS
-- ════════════════════════════════════════════

alter table public.records
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_audit_fields()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    new.created_by = coalesce(new.created_by, auth.uid());
    new.updated_at = now();
  elsif (TG_OP = 'UPDATE') then
    new.updated_by = auth.uid();
    new.updated_at = now();
  end if;
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_records_audit on public.records;
create trigger trg_records_audit
  before insert or update on public.records
  for each row execute function public.set_audit_fields();

-- 只有 staff 能读写 records
drop policy if exists "anon all access" on public.records;
drop policy if exists "authenticated all access" on public.records;
drop policy if exists "staff full access records" on public.records;
create policy "staff full access records"
  on public.records for all
  to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'staff')
  with check (auth.jwt()->'app_metadata'->>'role' = 'staff');
