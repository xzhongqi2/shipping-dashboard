# 海运拼箱 Dashboard — 多人共享版本 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单浏览器内存版的海运拼箱 Dashboard 改造成多人共享 web 版,销售在各自电脑录入,所有人看到所有数据,但成本和收入率仅管理员可见。

**Architecture:** React 19 + Vite + Tailwind v4 前端;Supabase Postgres + RLS + RPC 做后端,无 Auth、无 Edge Function。三层数据隔离:`records`(全员读写)、`cost_config`(只通过 RPC 暴露)、`admin_config`(永不出 DB)。30 秒轮询同步。

**Tech Stack:** React 19, Vite 8, Tailwind v4, @supabase/supabase-js v2, Postgres `pgcrypto` 扩展。

**Spec:** `docs/superpowers/specs/2026-05-17-multiuser-dashboard-design.md`

---

## File Structure

**新建文件:**

- `src/hooks/useClientId.js` — 浏览器唯一 ID 管理 (~15 行)
- `src/hooks/useRecords.js` — records CRUD + 30 秒轮询 (~80 行)
- `src/hooks/useAdmin.js` — 管理员登录态 + 成本读写 (~60 行)

**重写文件:**

- `supabase-schema.sql` — 整个文件内容替换为新 schema
- `src/lib/supabase.js` — 改成读 `import.meta.env`
- `src/App.jsx` — 多处增删改(详见 Tasks 5–10)

**说明:** 现有 App.jsx 把所有组件都内联在单文件里,这是项目的既有约定,本次保持。`AdminButton` / `CostConfigPanel` 也内联进 App.jsx。只有 hooks 因为有较多副作用逻辑(setInterval、错误处理),拆到 `src/hooks/`。

---

## Phase 0 — 数据库准备 (用户操作)

### Task 1: 重写 SQL Schema 文件

**Files:**
- Modify: `supabase-schema.sql` (整文件替换)

- [ ] **Step 1: 用以下内容替换整个 `supabase-schema.sql` 文件**

```sql
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
```

- [ ] **Step 2: 提交**

```bash
git add supabase-schema.sql
git commit -m "feat(db): rewrite schema for multi-user dashboard with cost RPC isolation"
```

---

### Task 2: 用户在 Supabase 跑 SQL (人工操作)

**这一步由用户在 Supabase Dashboard 执行,不是代码改动。给用户一份清晰的操作清单。**

- [ ] **Step 1: 让用户做以下三件事**

向用户输出以下指令(逐字复制,中文):

```
请按顺序操作:

1) 打开 Supabase 项目 → 左侧 SQL Editor → New query → 粘贴 supabase-schema.sql
   全部内容 → 点 Run。应看到 Success. No rows returned。

2) 在 SQL Editor 新建另一个 query,粘贴以下内容(把 '你的管理员密码'
   替换成你想用的密码),Run:

   insert into public.admin_config (id, password_hash)
   values (1, crypt('你的管理员密码', gen_salt('bf')))
   on conflict (id) do update set password_hash = excluded.password_hash;

3) 在 SQL Editor 再新建一个 query,粘贴以下内容,Run(初始成本沿用项目原有值):

   insert into public.cost_config (container, cost) values
     ('美西',   62243),
     ('美中南', 66734),
     ('美中北', 69259),
     ('美东南', 63845),
     ('美东北', 69259)
   on conflict (container) do update set cost = excluded.cost;

完成后告诉我"数据库就绪",我继续写前端。
```

- [ ] **Step 2: 等用户确认数据库就绪后,继续 Task 3**

---

## Phase 1 — Supabase 客户端配置

### Task 3: 把 supabase.js 改成读环境变量

**Files:**
- Modify: `src/lib/supabase.js`

- [ ] **Step 1: 用以下内容替换整个 `src/lib/supabase.js` 文件**

```js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
```

- [ ] **Step 2: 验证 .env 已经存在两个变量**

Run: `grep -E '^VITE_SUPABASE' .env`

Expected: 输出两行,分别是 `VITE_SUPABASE_URL=...` 和 `VITE_SUPABASE_ANON_KEY=...`。

如果缺失,告诉用户从 Supabase 项目的 Settings → API 复制对应值填入。

- [ ] **Step 3: 验证 dev server 能启动**

Run: `npm run dev` (启动后立即按 Ctrl+C)

Expected: 启动到 `Local: http://localhost:5173/` 后无 import.meta.env 报错。

- [ ] **Step 4: 提交**

```bash
git add src/lib/supabase.js
git commit -m "feat(supabase): read URL/key from env instead of hardcoding"
```

---

## Phase 2 — Hooks

### Task 4: 创建 useClientId hook

**Files:**
- Create: `src/hooks/useClientId.js`

- [ ] **Step 1: 创建 `src/hooks/useClientId.js`**

```js
import { useState } from 'react'

const STORAGE_KEY = 'shipping_client_id'

export function useClientId() {
  const [clientId] = useState(() => {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  })
  return clientId
}
```

- [ ] **Step 2: 提交**

```bash
git add src/hooks/useClientId.js
git commit -m "feat(hooks): add useClientId for browser-scoped record ownership"
```

---

### Task 5: 创建 useRecords hook

**Files:**
- Create: `src/hooks/useRecords.js`

- [ ] **Step 1: 创建 `src/hooks/useRecords.js`**

```js
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const POLL_INTERVAL_MS = 30_000

export function useRecords() {
  const [records, setRecords] = useState([])

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('records')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.warn('[useRecords] fetch failed:', error.message)
      return
    }
    setRecords(data ?? [])
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  const add = useCallback(async (newRecord) => {
    const { data, error } = await supabase
      .from('records')
      .insert(newRecord)
      .select()
      .single()
    if (error) throw error
    setRecords(prev => [data, ...prev])
    return data
  }, [])

  const update = useCallback(async (id, patch) => {
    const { data, error } = await supabase
      .from('records')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setRecords(prev => prev.map(r => r.id === id ? data : r))
    return data
  }, [])

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from('records').delete().eq('id', id)
    if (error) throw error
    setRecords(prev => prev.filter(r => r.id !== id))
  }, [])

  return { records, add, update, remove, refetch: fetchAll }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/hooks/useRecords.js
git commit -m "feat(hooks): add useRecords with CRUD + 30s polling"
```

---

### Task 6: 创建 useAdmin hook

**Files:**
- Create: `src/hooks/useAdmin.js`

- [ ] **Step 1: 创建 `src/hooks/useAdmin.js`**

```js
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [costs, setCosts] = useState({})  // { container: cost }
  const [password, setPassword] = useState('')

  const login = useCallback(async (pw) => {
    const { data, error } = await supabase.rpc('get_costs', { password: pw })
    if (error) throw error
    const map = {}
    for (const row of data) map[row.container] = Number(row.cost)
    setCosts(map)
    setPassword(pw)
    setIsAdmin(true)
  }, [])

  const logout = useCallback(() => {
    setIsAdmin(false)
    setCosts({})
    setPassword('')
  }, [])

  const updateCost = useCallback(async (container, cost) => {
    const { error } = await supabase.rpc('update_cost', {
      password,
      p_container: container,
      p_cost: cost,
    })
    if (error) throw error
    setCosts(prev => ({ ...prev, [container]: Number(cost) }))
  }, [password])

  return { isAdmin, costs, login, logout, updateCost }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/hooks/useAdmin.js
git commit -m "feat(hooks): add useAdmin with RPC-backed cost read/write"
```

---

## Phase 3 — App.jsx 改造

App.jsx 改造拆成多步,每步保持 build 不破。中间步骤里 App.jsx 会临时混用旧/新代码,但功能始终可用。

### Task 7: App.jsx — 接入 useRecords + useClientId,替换内存 records

**Files:**
- Modify: `src/App.jsx`

**这一步:**
- 把 `import { useState, useCallback } from 'react'` 改成 `import { useState, useCallback, useMemo } from 'react'`
- 加入 useRecords 和 useClientId 的 import
- App 主组件里删掉 `const [state, setState] = useState(EMPTY_STATE)` 和 `const [records, setRecords] = useState([])`,改用 `useRecords()` 和 `useClientId()`
- `handleSubmit`/`handleDelete`/`handleUpdate` 改成调 `add`/`remove`/`update`
- `state` 改用 `useMemo` 从 `records` 派生
- 暂时保留 `EMPTY_STATE`、`CONTAINERS` 里的 `cost`、`Auth` 组件 — 下面任务再删

- [ ] **Step 1: 修改 import 区**

替换 `src/App.jsx` 第 1 行:

```js
import { useState, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase'
import { useRecords } from './hooks/useRecords'
import { useClientId } from './hooks/useClientId'
```

- [ ] **Step 2: 修改 handleSubmit/handleDelete/handleUpdate 和 state 派生**

替换 App 函数(`export default function App()`)整体为以下内容(目前 `src/App.jsx:317-415`):

```jsx
export default function App() {
  const clientId = useClientId()
  const { records, add, update, remove } = useRecords()

  const state = useMemo(() => {
    const s = {}
    CONTAINERS.forEach(c => { s[c.name] = { cbm: 0, kg: 0, revenue: 0 } })
    records.forEach(r => {
      if (!s[r.container]) return
      s[r.container].cbm     += Number(r.cbm)
      s[r.container].kg      += Number(r.kg)
      s[r.container].revenue += Number(r.revenue)
    })
    return s
  }, [records])

  const handleSubmit = useCallback(async (salesperson, container, cbm, kg, revenue) => {
    try {
      await add({ salesperson, container, cbm, kg, revenue, client_id: clientId })
    } catch (e) {
      throw e
    }
  }, [add, clientId])

  const handleDelete = useCallback(async (id) => {
    try { await remove(id) }
    catch (e) { alert('删除失败:' + e.message) }
  }, [remove])

  const handleUpdate = useCallback(async (id, updated) => {
    try {
      await update(id, {
        salesperson: updated.salesperson,
        container:   updated.container,
        cbm:         parseFloat(updated.cbm) || 0,
        kg:          parseFloat(updated.kg)  || 0,
        revenue:     parseFloat(updated.revenue) || 0,
      })
    } catch (e) {
      alert('更新失败:' + e.message)
    }
  }, [update])

  return (
    <div className="min-h-screen bg-gray-50/80">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">⚓ 海运拼箱 Dashboard</h1>
            <p className="text-xs text-gray-400">实时追踪柜子装载、重量与收入情况</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div><InputForm onSubmit={handleSubmit} /></div>
          <div className="lg:col-span-2">
            <RecordList
              records={records}
              clientId={clientId}
              isAdmin={false}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
            />
          </div>
        </div>

        <div className="mb-6"><Summary state={state} /></div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {CONTAINERS.map(config => (
            <ContainerCard key={config.name} config={config} data={state[config.name]} />
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: 修改 InputForm 让它支持 async submit**

在 `src/App.jsx` 当前 InputForm 函数中,把 `submit = (e) => {` 改成 `submit = async (e) => {`,并把 `onSubmit(...)` 一行改成 `try/catch`:

替换原来的:

```jsx
    onSubmit(sales.trim(), name, c, k, r)
    setSales(''); setName(''); setCbm(''); setKg(''); setRev(''); setMsg('✅ 已添加')
    setTimeout(() => setMsg(''), 2000)
```

改成:

```jsx
    try {
      await onSubmit(sales.trim(), name, c, k, r)
      setSales(''); setName(''); setCbm(''); setKg(''); setRev(''); setMsg('✅ 已添加')
      setTimeout(() => setMsg(''), 2000)
    } catch (err) {
      setMsg('⚠️ 提交失败:' + err.message)
    }
```

- [ ] **Step 4: 修改 RecordList 接受 clientId / isAdmin props**

在 `src/App.jsx` 中,把 `function RecordList({ records, onDelete, onUpdate })` 改成 `function RecordList({ records, clientId, isAdmin, onDelete, onUpdate })`。

把"查看模式"块里的"编辑/删除"两个按钮区域:

```jsx
                  <div className="flex gap-3">
                    <button onClick={() => start(r)} className="text-xs text-blue-600 hover:text-blue-800">编辑</button>
                    <button onClick={() => onDelete(r.id)}  className="text-xs text-red-500 hover:text-red-700">删除</button>
                  </div>
```

改成:

```jsx
                  {(isAdmin || r.client_id === clientId) && (
                    <div className="flex gap-3">
                      <button onClick={() => start(r)} className="text-xs text-blue-600 hover:text-blue-800">编辑</button>
                      <button onClick={() => onDelete(r.id)}  className="text-xs text-red-500 hover:text-red-700">删除</button>
                    </div>
                  )}
```

注意 record 字段从 `r.created_at ?? r.time` 改成只用 `r.created_at`(原代码兼容旧数据,新版没必要):

把 `<span className="text-xs text-gray-400">{fmtTime(r.created_at ?? r.time)}</span>` 改成 `<span className="text-xs text-gray-400">{fmtTime(r.created_at)}</span>`

- [ ] **Step 5: lint 通过**

Run: `npm run lint`

Expected: 无错误。如有 unused-import 等警告可能需要清理。

- [ ] **Step 6: 启动 dev 手动验证**

Run: `npm run dev`

打开 `http://localhost:5173/`:
- 输入新记录 → 应该能看到记录出现在列表
- 刷新页面 → 记录还在(说明已落库)
- 在 records 上能点编辑/删除(因为 client_id 匹配)
- 开**无痕窗口**到同一地址 → 看到同一条记录,但**没有编辑/删除按钮**

按 Ctrl+C 停止。

- [ ] **Step 7: 提交**

```bash
git add src/App.jsx
git commit -m "feat(app): persist records via Supabase, derive aggregate from records"
```

---

### Task 8: App.jsx — 接入 useAdmin + AdminButton + 成本/收入率门禁

**Files:**
- Modify: `src/App.jsx`

这一步:
- 加 useAdmin import
- 内联新增 `AdminButton` 组件
- 从 `CONTAINERS` 删掉 `cost` 字段
- `ContainerCard` 接受 `cost` prop(管理员模式才传),`Summary` 接受 `costs` prop
- header 右上角放 AdminButton

- [ ] **Step 1: 加 useAdmin import**

在 `src/App.jsx` 顶部 import 区(第 1-5 行附近)加一行:

```js
import { useAdmin } from './hooks/useAdmin'
```

- [ ] **Step 2: 删除 CONTAINERS 里的 cost 字段**

把 `src/App.jsx` 当前的 CONTAINERS 数组(第 6-12 行):

```js
const CONTAINERS = [
  { name: '美西',   capacityCBM: 70, capacityKG: 12000, cost: 62243 },
  { name: '美中南', capacityCBM: 70, capacityKG: 12000, cost: 66734 },
  { name: '美中北', capacityCBM: 70, capacityKG: 12000, cost: 69259 },
  { name: '美东南', capacityCBM: 70, capacityKG: 12000, cost: 63845 },
  { name: '美东北', capacityCBM: 70, capacityKG: 12000, cost: 69259 },
]
```

改成:

```js
const CONTAINERS = [
  { name: '美西',   capacityCBM: 70, capacityKG: 12000 },
  { name: '美中南', capacityCBM: 70, capacityKG: 12000 },
  { name: '美中北', capacityCBM: 70, capacityKG: 12000 },
  { name: '美东南', capacityCBM: 70, capacityKG: 12000 },
  { name: '美东北', capacityCBM: 70, capacityKG: 12000 },
]
```

- [ ] **Step 3: 修改 ContainerCard 让 cost / 收入率成为可选**

把整个 `ContainerCard` 函数替换为:

```jsx
function ContainerCard({ config, data, cost }) {
  const loadRate    = data.cbm / config.capacityCBM
  const weightRate  = data.kg  / config.capacityKG
  const revenueRate = cost ? data.revenue / cost : null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">{config.name}</h3>
        {cost && (
          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">
            成本 ¥{cost.toLocaleString()}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center"><p className="text-xs text-gray-400">CBM</p>
          <p className="text-sm font-medium text-gray-700">{data.cbm} <span className="text-xs text-gray-400">/ {config.capacityCBM}</span></p></div>
        <div className="text-center"><p className="text-xs text-gray-400">KG</p>
          <p className="text-sm font-medium text-gray-700">{data.kg.toLocaleString()} <span className="text-xs text-gray-400">/ {config.capacityKG.toLocaleString()}</span></p></div>
        <div className="text-center"><p className="text-xs text-gray-400">收入</p>
          <p className="text-sm font-medium text-gray-700">¥{data.revenue.toLocaleString()}</p></div>
      </div>
      <div className="flex justify-around border-t border-gray-100 pt-4">
        <RateBadge value={loadRate}   label="装载率" />
        <RateBadge value={weightRate} label="重量率" />
        {revenueRate !== null && <RateBadge value={revenueRate} label="收入率" />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 修改 Summary 让 costs 成为可选**

把整个 `Summary` 函数替换为:

```jsx
function Summary({ state, costs }) {
  const totalCBM    = CONTAINERS.reduce((s, c) => s + state[c.name].cbm, 0)
  const totalKG     = CONTAINERS.reduce((s, c) => s + state[c.name].kg, 0)
  const totalRev    = CONTAINERS.reduce((s, c) => s + state[c.name].revenue, 0)
  const capCBM      = CONTAINERS.reduce((s, c) => s + c.capacityCBM, 0)
  const capKG       = CONTAINERS.reduce((s, c) => s + c.capacityKG, 0)
  const totalCost   = costs ? CONTAINERS.reduce((s, c) => s + (costs[c.name] || 0), 0) : 0

  const items = [
    { label: '总装载率', value: totalCBM / capCBM, detail: `${totalCBM} / ${capCBM} CBM` },
    { label: '总重量率', value: totalKG  / capKG,  detail: `${totalKG.toLocaleString()} / ${capKG.toLocaleString()} KG` },
  ]
  if (costs && totalCost > 0) {
    items.push({ label: '总收入率', value: totalRev / totalCost, detail: `¥${totalRev.toLocaleString()} / ¥${totalCost.toLocaleString()}` })
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">数据汇总</h3>
      <div className={`grid gap-4 ${items.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {items.map(item => {
          const good = item.value >= 1
          return (
            <div key={item.label} className="text-center">
              <span className={`text-2xl font-bold ${good ? 'text-green-600' : 'text-red-500'}`}>
                {(item.value * 100).toFixed(1)}%
              </span>
              <p className="text-xs text-gray-500 mt-1">{item.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{item.detail}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 新增 AdminButton 组件**

在 `src/App.jsx` 的 `Auth` 组件之前(就在 `// 组件:登录 / 注册` 那条注释行**之前**)插入:

```jsx
// ─────────────────────────────────
// 组件:管理员入口按钮
// ─────────────────────────────────
function AdminButton({ isAdmin, onLogin, onLogout }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw]     = useState('')
  const [err, setErr]   = useState('')
  const [busy, setBusy] = useState(false)

  if (isAdmin) {
    return (
      <button onClick={onLogout}
        className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg">
        退出管理员
      </button>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      await onLogin(pw)
      setOpen(false); setPw('')
    } catch (e) {
      setErr('密码错误')
    }
    setBusy(false)
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg">
        管理员
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-20" onClick={() => setOpen(false)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-lg p-6 w-80">
            <h3 className="text-base font-semibold text-gray-800 mb-4">管理员登录</h3>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="管理员密码"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3" />
            {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">取消</button>
              <button type="submit" disabled={busy}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50">
                {busy ? '验证中...' : '登录'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 6: 修改 App 函数,接入 useAdmin 和 AdminButton**

把 App 函数顶部的 hook 调用区扩展:

把:

```jsx
  const clientId = useClientId()
  const { records, add, update, remove } = useRecords()
```

改成:

```jsx
  const clientId = useClientId()
  const { records, add, update, remove } = useRecords()
  const { isAdmin, costs, login, logout, updateCost } = useAdmin()
```

把 header 区:

```jsx
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">⚓ 海运拼箱 Dashboard</h1>
            <p className="text-xs text-gray-400">实时追踪柜子装载、重量与收入情况</p>
          </div>
        </div>
```

改成:

```jsx
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">⚓ 海运拼箱 Dashboard</h1>
            <p className="text-xs text-gray-400">实时追踪柜子装载、重量与收入情况</p>
          </div>
          <AdminButton isAdmin={isAdmin} onLogin={login} onLogout={logout} />
        </div>
```

把 main 区里:

```jsx
            <RecordList
              records={records}
              clientId={clientId}
              isAdmin={false}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
            />
```

里 `isAdmin={false}` 改成 `isAdmin={isAdmin}`。

把 Summary 调用 `<Summary state={state} />` 改成 `<Summary state={state} costs={isAdmin ? costs : null} />`。

把柜子卡片 map:

```jsx
          {CONTAINERS.map(config => (
            <ContainerCard key={config.name} config={config} data={state[config.name]} />
          ))}
```

改成:

```jsx
          {CONTAINERS.map(config => (
            <ContainerCard
              key={config.name}
              config={config}
              data={state[config.name]}
              cost={isAdmin ? costs[config.name] : null}
            />
          ))}
```

- [ ] **Step 7: lint 通过**

Run: `npm run lint`

Expected: 无错误。

- [ ] **Step 8: 手动验证**

Run: `npm run dev`

- 默认视图:无收入率列、无成本角标、Summary 只两个数字
- 点右上角"管理员" → 弹框,输错密码 → 显示"密码错误"
- 输对密码 → 弹框关闭,出现收入率/成本/总收入率,按钮变成"退出管理员"
- 打开 devtools Network → 在销售视图下抓所有请求,**响应里没有任何 cost 字段**(除非已登录管理员)

- [ ] **Step 9: 提交**

```bash
git add src/App.jsx
git commit -m "feat(app): add admin button + cost/revenue gating via useAdmin"
```

---

### Task 9: App.jsx — CostConfigPanel(管理员可改成本)

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: 在 AdminButton 组件之前新增 CostConfigPanel**

在 `src/App.jsx` 的 `// 组件:管理员入口按钮` 注释**之前**插入:

```jsx
// ─────────────────────────────────
// 组件:成本配置面板 (仅管理员)
// ─────────────────────────────────
function CostConfigPanel({ costs, onUpdate }) {
  const [editing, setEditing] = useState(null)  // container name being edited
  const [draft, setDraft]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')

  const start = (container) => {
    setEditing(container); setDraft(String(costs[container] ?? '')); setErr('')
  }
  const save = async () => {
    const num = parseFloat(draft)
    if (isNaN(num) || num < 0) { setErr('请输入有效数字'); return }
    setBusy(true)
    try {
      await onUpdate(editing, num)
      setEditing(null); setDraft(''); setErr('')
    } catch (e) {
      setErr('保存失败:' + e.message)
    }
    setBusy(false)
  }
  const cancel = () => { setEditing(null); setDraft(''); setErr('') }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">成本配置 (仅管理员可见)</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CONTAINERS.map(c => (
          <div key={c.name} className="border border-gray-100 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{c.name}</p>
            {editing === c.name ? (
              <div>
                <input type="number" value={draft} onChange={e => setDraft(e.target.value)} autoFocus
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                <div className="flex gap-2 mt-2">
                  <button onClick={save} disabled={busy}
                    className="text-xs bg-green-600 text-white hover:bg-green-700 px-2 py-1 rounded disabled:opacity-50">
                    {busy ? '...' : '保存'}
                  </button>
                  <button onClick={cancel} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">取消</button>
                </div>
                {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">¥{(costs[c.name] ?? 0).toLocaleString()}</span>
                <button onClick={() => start(c.name)} className="text-xs text-blue-600 hover:text-blue-800">编辑</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 在 App 主组件里挂载 CostConfigPanel**

在 App 的 main 块内,Summary 之前(就是 `<div className="mb-6"><Summary ...` 那行**之前**)加:

```jsx
        {isAdmin && <CostConfigPanel costs={costs} onUpdate={updateCost} />}
```

- [ ] **Step 3: 手动验证**

Run: `npm run dev`

- 销售视图:看不到 CostConfigPanel
- 登录管理员:看到面板,点编辑,输新值,保存
- 保存成功:对应柜子卡片的"成本 ¥xxx"角标和收入率立即更新
- 刷新页面 → 重新登录管理员 → 成本依然是改后的值(说明已落库)
- 试错密码改不了(模拟方式:登录后手动 logout 再 login,验证流程没坏)

- [ ] **Step 4: 提交**

```bash
git add src/App.jsx
git commit -m "feat(app): add cost config panel for admin"
```

---

### Task 10: App.jsx — 清理死代码

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: 删除 Auth 组件**

删除 `src/App.jsx` 中整个 Auth 组件(从 `// 组件:登录 / 注册` 注释那行起,到 Auth 函数 `}` 结束行,即 `} // 主 App(无需登录)` 注释之前所有行)。

具体范围:删除以下区间(以当前文件位置为准):

```jsx
// ─────────────────────────────────
// 组件:登录 / 注册
// ─────────────────────────────────
function Auth({ onLogin }) {
  ...整个函数...
}
```

注意:Auth 引用了未导入的 `supabase`,留着会让 ESLint 报 `no-undef`,本步必删。

- [ ] **Step 2: 删除 EMPTY_STATE 常量**

删除 `src/App.jsx` 中:

```js
const EMPTY_STATE = {}
CONTAINERS.forEach(c => { EMPTY_STATE[c.name] = { cbm: 0, kg: 0, revenue: 0 } })
```

(之前 useMemo 已经替代了这个工具变量,现在可以删。)

- [ ] **Step 3: 把"主 App(无需登录)"注释改成"主 App"**

把:

```jsx
// ─────────────────────────────────
// 主 App(无需登录)
// ─────────────────────────────────
```

改成:

```jsx
// ─────────────────────────────────
// 主 App
// ─────────────────────────────────
```

- [ ] **Step 4: lint 通过**

Run: `npm run lint`

Expected: 无错误。如果还有 unused import/variable,清理掉。

- [ ] **Step 5: build 通过**

Run: `npm run build`

Expected: build 成功,无错误。

- [ ] **Step 6: 提交**

```bash
git add src/App.jsx
git commit -m "chore(app): remove dead Auth component and unused EMPTY_STATE"
```

---

## Phase 4 — 收尾验证

### Task 11: 全功能手动验证

**Files:** 无改动,只验证。

- [ ] **Step 1: 启动 dev 环境**

Run: `npm run dev`

- [ ] **Step 2: 数据库层验证 (在 Supabase SQL Editor)**

让用户依次跑以下三条 query,记录结果:

```sql
-- a) 直接读 cost_config 应该被 RLS 挡住返回空
select * from public.cost_config;

-- b) 错密码应该报错
select * from public.get_costs('完全错误的密码');

-- c) 对密码应该返回 5 行
select * from public.get_costs('你设置的真实密码');
```

Expected:
- a) 用 anon role 跑返回 0 行(用 service_role 会看到 5 行,这是预期);从前端 client 看 a) 是 0 行
- b) 抛 `invalid password` 错误
- c) 返回 5 行

- [ ] **Step 3: 销售端验证 (普通浏览器窗口)**

打开 `http://localhost:5173/`:

- [ ] 输入一条新记录(姓名/柜子/CBM/KG/收入)→ 列表立即出现
- [ ] 该记录有"编辑/删除"按钮
- [ ] 编辑该记录 → 修改 CBM 值 → 保存 → 卡片汇总数据相应变化
- [ ] 删除该记录 → 列表移除,汇总减回去
- [ ] 柜子卡片**不显示**"成本 ¥xxx"角标
- [ ] 柜子卡片**不显示**"收入率"徽章
- [ ] 数据汇总只有"总装载率"和"总重量率"两个数字
- [ ] 顶部右侧有"管理员"按钮

- [ ] **Step 4: 跨浏览器验证(用无痕窗口模拟另一个销售)**

开无痕窗口到同一地址:

- [ ] 看到普通窗口刚才输入的记录(说明数据真的在云端)
- [ ] 该记录**没有**编辑/删除按钮(client_id 不匹配)
- [ ] 在无痕窗口提交一条新记录
- [ ] 普通窗口 30 秒内自动刷出无痕窗口的新记录(说明轮询工作)

- [ ] **Step 5: Network 面板审计 (关键安全验证)**

在普通浏览器(销售视图,**不**登录管理员)按 F12 打开 devtools,切到 Network:

- [ ] 刷新页面,看 `records?select=*` 响应:**不应**包含任何 cost 字段
- [ ] 在 Network 里所有请求过滤搜索 `cost`、`password`、`hash`:**不应**有任何匹配响应

- [ ] **Step 6: 管理员端验证**

回到普通浏览器,点"管理员":

- [ ] 输错密码 → "密码错误"
- [ ] 输对密码 → 弹框关闭
- [ ] 顶部按钮变成"退出管理员"
- [ ] 出现"成本配置 (仅管理员可见)" 面板,五个柜子的成本数字
- [ ] 柜子卡片右上角出现"成本 ¥xxx"
- [ ] 柜子卡片底部多一个"收入率"徽章
- [ ] 数据汇总变成三个数字,多了"总收入率"
- [ ] **能编辑别人(无痕窗口)创建的记录**(管理员权限覆盖 client_id 检查)
- [ ] 在成本配置面板改一个柜子的成本 → 保存 → 卡片立即刷新
- [ ] 刷新整页 → 重新登录管理员 → 改后的成本依然在
- [ ] 点"退出管理员" → 收入率/成本/面板都消失

- [ ] **Step 7: lint + build 最终验证**

Run: `npm run lint && npm run build`

Expected: 都通过,无错误。

- [ ] **Step 8: 在 README.md 顶部追加一句关于多人共享的说明(可选)**

如果用户希望后续协作者一眼看到这是多人版本,可在 README.md 第 1 行 `# React + Vite` 之后插入一行:

```
> 海运拼箱多人共享 Dashboard。本地运行需先在 Supabase 跑 supabase-schema.sql,并在 .env 填入 VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY。详见 docs/superpowers/specs/2026-05-17-multiuser-dashboard-design.md。
```

如果不做这步,跳过即可。

- [ ] **Step 9: 最终提交(如果做了 README 改动)**

```bash
git add README.md
git commit -m "docs: note multi-user dashboard setup in README"
```

---

## 备忘:用户后续要做的事

代码完成后,告诉用户:

1. **本地验证完毕后**,按 `DEPLOYMENT_GUIDE.md` 把代码 push 到 GitHub,在 Vercel 部署。
2. **Vercel 部署时**,在项目 Settings → Environment Variables 填入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`(跟本地 `.env` 一样)。
3. **以后改密码**:在 Supabase SQL Editor 跑 `update public.admin_config set password_hash = crypt('新密码', gen_salt('bf')) where id = 1;`(本次没在前端做改密码 UI,因为成本极低)。
4. **以后改成本**:在管理员页面"成本配置"面板里直接改,不用再碰 SQL。
