# 海运拼箱 Dashboard — 多人共享版本设计

**日期:** 2026-05-17
**状态:** 设计待实施

## 背景

当前 Dashboard (`src/App.jsx`) 是单用户单浏览器的工具,所有 records 存在 React state 里,刷新即丢。需要改造成多人协作的 web 版本,让销售在各自电脑录入,管理员能看到汇总结果。

最近一次提交 `209e3a7 Remove login: show dashboard directly` 已经把登录页从渲染路径去掉,本次改造跟这个方向对齐:**销售端不登录**。

## 需求要点

- **登录方式**:销售不登录,姓名手输(沿用现状)。
- **数据可见性**:所有人看到所有 records 和柜子的 CBM/KG 装载率;**成本和收入率只有管理员能看**。
- **管理员识别**:页面右上角"管理员"按钮 → 输密码 → 切到管理员视图。**任何电脑输对密码都能进**(为了让你给信任的人看)。
- **实时性**:30 秒定时轮询,不用 Realtime 推送。
- **编辑/删除权限**:销售只能改自己刚录入的(本浏览器 `client_id` 匹配);管理员能改所有人的。
- **部署目标**:Supabase + Vercel,沿用 `DEPLOYMENT_GUIDE.md` 思路;用户尽量少配置。

## 关键安全约束

成本数据和管理员密码**绝不能出现在销售收到的网络响应里** — 销售打开 devtools Network 面板时,看到的 JSON 里不能有 `cost` 字段、不能有 `password_hash`。这是整个数据建模的硬约束。

## 架构

技术栈不变:**React 19 + Vite + Tailwind v4 + Supabase**。Supabase 这边只用 **Postgres + RLS + 一个 RPC 函数**;不用 Auth、不用 Edge Function、不用 Realtime。

数据划成三层,按"谁能读"区隔:

| 数据 | 存放 | 谁能读 |
|---|---|---|
| `records` (录入记录) | Supabase 表,RLS 全开 | 所有 anon 都能读写 |
| `cost_config` (柜子成本) | Supabase 表,RLS 关闭所有 anon 直读 | 只能通过 `get_costs(password)` RPC,密码对了才返回 |
| `admin_config` (密码哈希) | Supabase 表,RLS 关闭所有 anon 直读 | 只在数据库内部用,前端永远拿不到 |

## 数据模型

### `records` 表

```sql
create table public.records (
  id          bigint generated always as identity primary key,
  salesperson text        not null,
  container   text        not null check (container in ('美西','美中南','美中北','美东南','美东北')),
  cbm         numeric     not null default 0,
  kg          numeric     not null default 0,
  revenue     numeric     not null default 0,
  client_id   text        not null,
  created_at  timestamptz not null default now()
);

alter table public.records enable row level security;

create policy "anon all access"
  on public.records for all
  using (true) with check (true);

create index idx_records_created on public.records (created_at desc);
```

跟现有 `supabase-schema.sql` 的差别:

- 去掉 `user_id` 列和基于 `auth.uid()` 的 RLS 策略 (因为不登录)
- 新增 `client_id` 列 — 浏览器首次访问时生成 (`crypto.randomUUID()`),存 localStorage,提交时带上;前端用 `record.client_id === myClientId` 判断"是不是我刚输的"
- `created_at` 改 `timestamptz`,跨时区/电脑显示更稳

### `cost_config` 表

```sql
create table public.cost_config (
  container text primary key,
  cost      numeric not null
);
alter table public.cost_config enable row level security;
-- 不写任何 policy → anon 完全无法 SELECT/INSERT/UPDATE
```

### `admin_config` 表

```sql
create extension if not exists pgcrypto;

create table public.admin_config (
  id            int primary key default 1,
  password_hash text not null
);
alter table public.admin_config enable row level security;
```

### RPC 函数

```sql
-- 验证密码 → 返回成本
create or replace function public.get_costs(password text)
returns setof public.cost_config
language plpgsql security definer as $$
declare h text;
begin
  select password_hash into h from public.admin_config where id = 1;
  if not (crypt(password, h) = h) then
    raise exception 'invalid password';
  end if;
  return query select * from public.cost_config;
end; $$;

grant execute on function public.get_costs(text) to anon;

-- 验证密码 → 修改单个柜子的成本
create or replace function public.update_cost(password text, p_container text, p_cost numeric)
returns void
language plpgsql security definer as $$
declare h text;
begin
  select password_hash into h from public.admin_config where id = 1;
  if not (crypt(password, h) = h) then
    raise exception 'invalid password';
  end if;
  update public.cost_config set cost = p_cost where container = p_container;
end; $$;

grant execute on function public.update_cost(text, text, numeric) to anon;
```

`security definer` 让函数以 owner 身份运行,绕过 RLS 读 `admin_config`/`cost_config`;但密码校验失败就 `raise exception`,什么都不返回。bcrypt 哈希用不同 salt,即使 dump 了表也反推不出明文。

## 前端组件设计

`src/App.jsx` 还是单文件,但拆出几个新职责:

### Hooks (新增)

- **`useClientId()`** — 从 `localStorage.client_id` 读;没有就 `crypto.randomUUID()` 生成并写入。
- **`useRecords()`** — 封装所有 records CRUD,内部 `setInterval(fetch, 30_000)` 做轮询。暴露 `{ records, add, update, remove }`。乐观更新:写操作成功后立即改本地 state,不等下次轮询。
- **`useAdmin()`** — 管 `{ isAdmin, costs, login(password), logout(), updateCost(container, cost) }`。`costs` 和当前密码都只放 React state(内存),退出/刷新即清空。`login` 调 `rpc('get_costs', {password})`,成功就把返回的成本数组转成 `{container: cost}` map 存进 state、密码也存进 state(后续 `updateCost` 复用);失败就抛错。

### 组件改动

- **`AdminButton`** — 右上角小按钮。未登录显示"管理员",点击弹密码框;已登录显示"退出管理员"。
- **`CostConfigPanel`** — 仅 `isAdmin` 时显示。五个柜子的成本输入框,改动调 `useAdmin().updateCost()` → RPC。
- **`RecordList`** — 编辑/删除按钮可见性条件:`isAdmin || record.client_id === myClientId`。
- **`ContainerCard`** — 收入率(revenue / cost)和"成本 ¥xxx"那个角标,仅 `isAdmin` 时渲染。非管理员只看 CBM 装载率和 KG 重量率。
- **`Summary`** — 同上,"总收入率"列仅 `isAdmin` 时渲染。

### 删除

- `Auth` 组件(彻底移除,跟最近"删登录"提交一致)。
- `App.jsx` 顶部 `CONTAINERS` 里的 `cost` 字段(从前端代码消失,搬到云端 `cost_config` 表)。
- 现在 App 里手动维护的 `state` 聚合(`EMPTY_STATE` 和 `setState` 那套):改成 `useMemo` 从 `records` 实时 reduce,只剩一份真相。

## 数据流

**销售提交记录:**

```
InputForm.onSubmit
  → useRecords.add({ salesperson, container, cbm, kg, revenue, client_id: myClientId })
  → supabase.from('records').insert(...)
  → 成功:本地 records state 加上这条
  → 失败:表单显示"⚠️ 提交失败",输入内容保留
```

**30 秒轮询:**

```
setInterval(30_000)
  → supabase.from('records').select('*').order('created_at', { ascending: false })
  → 比较 id 列表,有变化就替换 state
  → 失败:console.warn,下一轮再试,不弹错
```

**进入管理员:**

```
点"管理员"按钮 → 弹密码框 → useAdmin.login(password)
  → supabase.rpc('get_costs', { password })
  → 成功:costs 存进 state,isAdmin = true
  → 失败:弹框显示"密码错误",不清密码框
```

**修改成本:**

```
CostConfigPanel 改值 → useAdmin.updateCost(container, cost)
  → supabase.rpc('update_cost', { password: 缓存的密码, p_container, p_cost })
  → 成功:本地 costs state 更新
  → 失败:toast 红字,值回滚
```

注意:`useAdmin` 进入管理员模式后,密码会暂存在 React state(只在内存)里,以便后续 `update_cost` 调用复用。退出管理员或刷新页面就清掉。

## 错误处理 — 写什么 / 不写什么

| 场景 | 处理 |
|---|---|
| Supabase 挂了,records 提交失败 | 表单红字"⚠️ 提交失败,请重试",保留输入 |
| 30 秒轮询失败 | console.warn,下一轮再试 |
| 管理员密码错 | 弹框红字"密码错误",不清密码框 |
| records 编辑/删除失败 | toast 红字"操作失败",本地 state 回滚 |
| 两个销售同时改同一条 record | 不处理 — 后写覆盖先写,30 秒后大家拉到最终一致 |

**故意不实现:**

- 重连/retry 队列、离线模式 — 用户体量小,网络断了刷新即可
- Loading skeleton — 30 秒轮询用户感知不到
- 乐观锁/版本号 — 这种小团队场景,冲突极少,处理成本超过收益

## 测试策略

项目目前没有测试框架,本次**不**新增。理由:业务逻辑薄(表单 + CRUD + group by 聚合);真正容易出错的是 Supabase 网络/RLS 行为,单元测试覆盖不到。

**手动验证 checklist:**

1. **schema/RPC 层** — Supabase SQL Editor 里:
   - 用 anon key `select * from cost_config` → 应该返回空 (RLS 拦住)
   - `select get_costs('错密码')` → 报错
   - `select get_costs('对密码')` → 返回 5 行
2. **销售端** — 本地 `npm run dev`:
   - 输入新记录 → 看到自己能编辑/删除
   - 开无痕窗口 → 同一条记录看不到编辑/删除按钮
   - 30 秒后无痕窗口能看到新记录
   - 收入率列、成本角标不显示
   - **devtools Network 面板:抓所有响应,确认没有任何 `cost` / `password_hash` 字段**
3. **管理员端**:
   - 点"管理员" → 输错密码 → 报错
   - 输对密码 → 看到收入率和成本
   - 改一个柜子成本 → 刷新仍在
   - 退出管理员 → 收入率消失
4. **Lint** — `npm run lint` 通过

## 部署步骤 (用户视角)

我会把代码改完、把 SQL 脚本写好。用户需要做的:

1. Supabase 网页建项目 (用户操作,~3 分钟)
2. SQL Editor 跑一遍建表/RPC 脚本 (我会把现有 `supabase-schema.sql` 改写好,粘贴运行 — ~30 秒)
3. SQL Editor 跑 `insert into admin_config values (1, crypt('你想的密码', gen_salt('bf')))` (用户改密码 — ~30 秒)
4. SQL Editor 跑五条 insert 写初始成本 (~1 分钟)
5. 把 Project URL 和 anon key 填到 `.env` (~1 分钟)
6. `npm run dev` 本地验证 → 之后 push 到 Vercel(沿用 `DEPLOYMENT_GUIDE.md`)

之后改密码、改成本都在管理员页面里完成,不用再碰 SQL。

## 不做的事 (Out of scope)

- 不重新引入登录系统
- 不实现 Realtime 推送(轮询足够)
- 不写自动化测试
- 不动 `CONTAINERS` 里的五个柜子配置(名称、容量) — 这次只把 `cost` 搬走
- 不做历史/审计日志

## 开放问题

无。
