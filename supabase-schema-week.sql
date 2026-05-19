-- ════════════════════════════════════════════
-- 海运拼箱 Dashboard — 按周存档 schema 变更
-- 在 Supabase → SQL Editor 中执行本脚本
-- ════════════════════════════════════════════

-- 1. records 加 week_number 列, 历史数据回填到 1
alter table public.records
  add column if not exists week_number int not null default 1;

alter table public.records
  add constraint records_week_range check (week_number between 1 and 53);

create index if not exists idx_records_week on public.records (week_number);

-- 2. app_state 表
create table if not exists public.app_state (
  id           int primary key default 1,
  current_week int not null default 1,
  constraint app_state_singleton check (id = 1),
  constraint app_state_week_range check (current_week between 1 and 53)
);

insert into public.app_state (id, current_week)
  values (1, extract(week from current_date)::int)
  on conflict (id) do nothing;

alter table public.app_state enable row level security;

drop policy if exists "anon read app_state" on public.app_state;
create policy "anon read app_state" on public.app_state for select using (true);

-- 3. RPC: advance_week(password) → current_week + 1
create or replace function public.advance_week(password text)
returns int
language plpgsql security definer as $$
declare
  h text;
  new_week int;
begin
  select password_hash into h from public.admin_config where id = 1;
  if h is null or not (crypt(password, h) = h) then
    raise exception 'invalid password';
  end if;
  update public.app_state
    set current_week = least(current_week + 1, 53)
    where id = 1
    returning current_week into new_week;
  return new_week;
end; $$;

grant execute on function public.advance_week(text) to anon;

-- 4. RPC: set_current_week(password, week) → admin manual override
create or replace function public.set_current_week(password text, p_week int)
returns int
language plpgsql security definer as $$
declare h text;
begin
  if p_week < 1 or p_week > 53 then
    raise exception 'week out of range';
  end if;
  select password_hash into h from public.admin_config where id = 1;
  if h is null or not (crypt(password, h) = h) then
    raise exception 'invalid password';
  end if;
  update public.app_state set current_week = p_week where id = 1;
  return p_week;
end; $$;

grant execute on function public.set_current_week(text, int) to anon;
