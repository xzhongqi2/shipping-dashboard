# 设计文档:按周存档与周切换

**日期:** 2026-05-18
**作者:** Vincent Xing(口述需求)+ Claude(整理)
**状态:** 待实施

## 背景与动机

`海运拼箱 Dashboard` 当前所有 records 混在一起,没有"周"的概念,数据只能不停累加。业务上每周需要复盘当周柜子装载、重量、收入情况,然后开始新一周。本设计在不丢失历史的前提下,让数据按 ISO 周分隔归档,提供周间切换和周汇总能力。

## 需求

源自用户原话:

1. 数据汇总区域加一个 Wk1–Wk52 的下拉菜单,有数据的周字体变红
2. 加"进入下一周"按钮:按一下保存当周数据,进入下一周,所有页面数据清零
3. 加一个框,列出所有有数据的周的三个总率(总装载率、总重量率、总收入率)

经讨论澄清:
- 周编号按 ISO 日历自动算(WK 1–53,UI 上 1–52 已够,但底层支持 53)
- "数据清零"语义为按周存档:不删数据,只是切换显示窗口,旧周数据可回看
- "进入下一周"仅管理员可执行(避免误操作)
- 周汇总表仅显示三个总率,不展开柜子明细

## 架构

### 数据流

```
                    ┌─────────────────┐
                    │   app_state     │  ← 全局当前活跃周
                    │  current_week   │
                    └────────┬────────┘
                             │ 30s 轮询
                             ↓
        ┌──────────────────────────────────────┐
        │          useWeek (新 hook)            │
        │ - currentWeek (来自 app_state)        │
        │ - selectedWeek (UI 选中的周, 默认=current) │
        │ - advance(password) → RPC             │
        └─────────┬────────────────┬───────────┘
                  │                │
                  ↓                ↓
          InputForm          Summary / ContainerCard
          (写入: week=current)  (读取: 按 selectedWeek 过滤)
                  │
                  ↓
          ┌─────────────────┐
          │  records 表      │
          │  + week_number  │ ← 新加列
          └─────────────────┘
```

### 关键不变量

- 录入永远写入"当前活跃周"(`currentWeek`),与 UI 选中的周(`selectedWeek`)解耦
- "进入下一周"只改 `app_state.current_week`,不动任何 records
- 多客户端通过轮询 `app_state` 同步"当前活跃周"

## 数据库 schema 变更

执行一次性 SQL 脚本(SQL Editor 中跑,会作为本设计实施的一部分提交到 repo,文件名建议 `supabase-schema-week.sql`):

```sql
-- 1. records 加 week_number 列, 历史数据回填到 1
alter table public.records
  add column if not exists week_number int not null default 1
  check (week_number between 1 and 53);

create index if not exists idx_records_week on public.records (week_number);

-- 2. app_state 表, 单行记录当前活跃周
create table if not exists public.app_state (
  id           int primary key default 1,
  current_week int not null default 1 check (current_week between 1 and 53),
  constraint app_state_singleton check (id = 1)
);

-- 初始 current_week 设为今日的 ISO 周(执行时算)
insert into public.app_state (id, current_week)
  values (1, extract(week from current_date)::int)
  on conflict (id) do nothing;

alter table public.app_state enable row level security;

-- anon 可读, 不可写
drop policy if exists "anon read app_state" on public.app_state;
create policy "anon read app_state" on public.app_state for select using (true);

-- 3. RPC: advance_week(密码) → current_week + 1
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

-- 4. RPC: set_current_week(密码, 周) → 管理员手动调整(用于回退/纠错)
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
```

### 字段约束

- `records.week_number` 1–53,有 CHECK,不允许 NULL
- `app_state` 是单行表(`id=1`),用 CHECK 约束防多行
- RPC 跟 `update_cost` 走同一种 `security definer` + 密码校验模式

## 组件与文件改动

### 新增

- **`src/hooks/useWeek.js`** — 新 hook
  - `useEffect` 启动时拉 `app_state`,30s 轮询
  - 暴露 `{ currentWeek, selectedWeek, setSelectedWeek, advance(password), setWeek(password, week) }`
  - 组件挂载时 `selectedWeek` 默认等于 `currentWeek`,之后由用户手动切

- **`src/components/WeekSummaryTable.jsx`** —(可考虑直接放 App.jsx 内,看体量)
  - 接收 `records`, `costs`(可选), `onSelectWeek` 回调
  - 在 `records` 上 group by `week_number`,算每周三个总率
  - 排序:周数升序
  - 行点击触发 `onSelectWeek(week)`

- **`supabase-schema-week.sql`** — 上面那段 SQL,提交到 repo 根目录

### 修改

- **`src/hooks/useRecords.js`**
  - `add` 方法接收 `week_number` 参数(由调用方传入,而不是 hook 内部决策),原因是 hook 不应该耦合 useWeek

- **`src/App.jsx`**
  - 引入 `useWeek`
  - `state` 计算改为只对 `selectedWeek` 的 records 做 reduce
  - `handleSubmit` 把 `week_number: currentWeek` 加入 `add()` 调用
  - `Summary` 组件:加下拉(子组件 `WeekSelector`),传入 `selectedWeek`、`onChange`、`weeksWithData`(set)、`currentWeek`
  - `InputForm` 当 `selectedWeek !== currentWeek` 时显示提示条 + 禁用提交按钮
  - Header 加 `<NextWeekButton>`(仅 isAdmin 渲染),内部弹确认框,点击后调 `advance(password)`
  - 主区域底部加 `<WeekSummaryTable>`

### 不变

- `useAdmin.js`、`useClientId.js` 不动
- `cost_config` / `update_cost` 不动
- 现有 `RateBadge` / `ContainerCard` 不动

## UI 细节

### WeekSelector 下拉

- 52 项 Wk1–Wk52(实际显示到 53 也行,但用户说 52,先按 52)
- 有数据的周:`text-red-600 font-semibold`
- 无数据的周:`text-gray-400`
- 当前活跃周后缀 `(本周)` 标签
- 默认选中 `currentWeek`

### NextWeekButton

- 仅 `isAdmin` 时渲染,放在 header AdminButton 左侧
- 文字:"进入下一周"
- 点击 → 模态框:"确定从 Wk{N} 进入 Wk{N+1} 吗?Wk{N} 数据将归档保留。"
- 确认后调 `advance(password)`,密码从 `useAdmin` 拿(已经存在内存里)

### WeekSummaryTable

- 标题:"周汇总"
- 列:周 | 总装载率 | 总重量率 | 总收入率
- 只列出 `weeksWithData`,按周数升序
- 数值颜色规则:≥100% 绿色,<100% 红色
- 收入率列:管理员且该周柜子有成本配置时显示真实值,否则 `--`
- 整行 hover 高亮 + 点击切到该周

### InputForm 历史模式

- 当 `selectedWeek !== currentWeek` 时,在表单顶部显示一条黄色提示:"查看历史(Wk{N}),录入功能仅在 Wk{currentWeek}(本周)可用"
- "添加" 按钮禁用置灰

## 错误处理

- `advance_week` RPC 失败(密码错):弹 alert "推进失败,请重新登录管理员"
- `app_state` 拉取失败:`useWeek` 内部 fallback 到 `currentWeek=1`,console.warn,不阻塞 UI
- `add` 调用时 `currentWeek` 未加载完(为 null):InputForm 提交按钮置灰,显示"加载中..."

## 测试与验证

项目无测试框架,**不**新增。改完后:

1. `npm run lint` 通过
2. `npm run build` 通过
3. `npm run dev` 手动走查:
   - [ ] 下拉选不同周,聚合数据正确变化
   - [ ] 默认选中等于当前活跃周
   - [ ] 录入新记录后该周在下拉里变红
   - [ ] 管理员"进入下一周",`current_week` +1,新录入进新周
   - [ ] 历史周下录入按钮置灰
   - [ ] 周汇总表点行切周成功
   - [ ] 非管理员看不到"进入下一周"按钮
   - [ ] 退出管理员后,刚才看到的"进入下一周"按钮立即消失

## 回滚

- **前端**:`git revert` 整个 commit。新 schema 字段不读不写也无害。
- **数据库**:新加的列、表、RPC 都是增量,不动旧逻辑。出问题只 revert 前端即可,DB 改动可保留。
- **完全清理**(若决定彻底放弃):`alter table records drop column week_number; drop table app_state; drop function advance_week; drop function set_current_week;`

## 不做(YAGNI)

- 按月/按季度汇总
- 导出 CSV
- 按销售人员分组的周报
- 跨周对比图表
- 周快照(归档时拷贝一份只读 snapshot)— 当前 records 不会被覆盖,直接按 week_number 查就够了

## 已确认决策记录

| 议题 | 决定 |
|------|------|
| 周编号方式 | ISO 日历自动算(底层 1–53,UI 1–52) |
| 数据清零语义 | 按周存档,records 全部保留 |
| 谁能进入下一周 | 仅管理员 |
| 周汇总表粒度 | 仅三个总率,不展开柜子明细 |
| 历史 records 回填周 | 全部填 `week_number = 1` |
| 看历史时录入 | 锁住,禁用提交 |
| 是否提供回退 RPC | 提供 `set_current_week`,但 UI 暴露最小(管理员小齿轮) |
