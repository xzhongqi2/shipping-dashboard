-- ════════════════════════════════════════════
-- 海运拼箱 Dashboard — 增加「锁仓柜」
-- 在 Supabase → SQL Editor 中执行本脚本
-- ════════════════════════════════════════════

-- 1. records 表 container CHECK 约束扩容,接受「锁仓柜」
alter table public.records drop constraint if exists records_container_check;
alter table public.records add constraint records_container_check
  check (container in ('美西','美中南','美中北','美东南','美东北','锁仓柜'));

-- 2. cost_config 加一行,默认成本 0(管理员之后自己调)
insert into public.cost_config (container, cost)
  values ('锁仓柜', 0)
  on conflict (container) do nothing;
