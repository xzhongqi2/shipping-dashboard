-- ════════════════════════════════════════════
-- 海运拼箱 Dashboard — Supabase 建表脚本 (多人共享版)
-- 在 Supabase → SQL Editor 中执行本脚本
-- ════════════════════════════════════════════

-- 0. 启用 pgcrypto 扩展 (用于 bcrypt 密码哈希)
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- 1. records 表:所有销售共享读写
-- ─────────────────────────────────────────────
create table if not exists public.records (
  id          bigint generated always as identity primary key,
  salesperson text        not null,
  container   text        not null check (container in ('美西','美中南','美中北','美东南','美东北')),
  cbm         numeric     not null default 0,
  kg          numeric     not null default 0,
  revenue     numeric     not null default 0,
  client_id   text        not null,
  created_at  timestamptz not null default now()
);

-- 兼容已经跑过旧 schema 的项目:清掉旧 policy 和 user_id 列,补上 client_id
drop policy if exists "用户读写自己记录" on public.records;
alter table public.records drop column if exists user_id;
alter table public.records add column if not exists client_id text not null default 'legacy';
alter table public.records alter column client_id drop default;

alter table public.records enable row level security;

drop policy if exists "anon all access" on public.records;
create policy "anon all access"
  on public.records for all
  using (true) with check (true);

create index if not exists idx_records_created on public.records (created_at desc);

-- ─────────────────────────────────────────────
-- 2. cost_config 表:成本配置 (anon 不可直读)
-- ─────────────────────────────────────────────
create table if not exists public.cost_config (
  container text primary key,
  cost      numeric not null
);
alter table public.cost_config enable row level security;
-- 不写任何 policy → anon 完全无法访问

-- ─────────────────────────────────────────────
-- 3. admin_config 表:管理员密码哈希
-- ─────────────────────────────────────────────
create table if not exists public.admin_config (
  id            int primary key default 1,
  password_hash text not null
);
alter table public.admin_config enable row level security;
-- 不写任何 policy → anon 完全无法访问

-- ─────────────────────────────────────────────
-- 4. RPC: get_costs(密码) → 返回成本数据
-- ─────────────────────────────────────────────
create or replace function public.get_costs(password text)
returns setof public.cost_config
language plpgsql security definer as $$
declare h text;
begin
  select password_hash into h from public.admin_config where id = 1;
  if h is null or not (crypt(password, h) = h) then
    raise exception 'invalid password';
  end if;
  return query select * from public.cost_config order by container;
end; $$;

grant execute on function public.get_costs(text) to anon;

-- ─────────────────────────────────────────────
-- 5. RPC: update_cost(密码, 柜子, 成本) → 改单个柜子成本
-- ─────────────────────────────────────────────
create or replace function public.update_cost(password text, p_container text, p_cost numeric)
returns void
language plpgsql security definer as $$
declare h text;
begin
  select password_hash into h from public.admin_config where id = 1;
  if h is null or not (crypt(password, h) = h) then
    raise exception 'invalid password';
  end if;
  update public.cost_config set cost = p_cost where container = p_container;
end; $$;

grant execute on function public.update_cost(text, text, numeric) to anon;

-- ✅ 完成。记得接下来执行:
--   • insert into admin_config (id, password_hash) values (1, crypt('你的密码', gen_salt('bf')));
--   • 五条 cost_config 初始 insert (见部署说明)
