-- ════════════════════════════════════════════
-- 海运拼箱 Dashboard — Supabase 建表脚本
-- 在 Supabase → SQL Editor 中执行本脚本
-- ════════════════════════════════════════════

-- 1. 创建记录表
create table if not exists public.records (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  salesperson text        not null,
  container   text        not null check (container in ('美西','美中南','美中北','美东南','美东北')),
  cbm         numeric     not null default 0,
  kg          numeric     not null default 0,
  revenue     numeric     not null default 0,
  created_at  timestamp   not null default now()
);

-- 2. 开启行级安全（RLS）
alter table public.records enable row level security;

-- 3. 策略：用户只能操作自己的记录
create policy "用户读写自己记录"
  on public.records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4. 为 created_at 创建索引（加速排序）
create index if not exists idx_records_user_created
  on public.records (user_id, created_at desc);

-- ✅ 完成！
-- 验证：左侧菜单 Database → Tables → 应看到 records 表
