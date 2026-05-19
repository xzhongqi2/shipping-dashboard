# Weekly Archive & Week-Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-week data archiving with a week selector dropdown, admin-only "next week" button, and a weekly totals summary table.

**Architecture:** Add `week_number` column to `records`, a singleton `app_state` table for the shared current week, and two admin-gated RPCs (`advance_week`, `set_current_week`). A new `useWeek` hook manages week state. The UI gets a dropdown in Summary, a NextWeekButton in the header, and a WeekSummaryTable below the container cards.

**Tech Stack:** React 19, Vite, Tailwind v4, Supabase (PostgreSQL + JS client)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase-schema-week.sql` | One-time SQL migration for week_number, app_state, RPCs |
| Create | `src/hooks/useWeek.js` | Hook: read/poll app_state, expose currentWeek/selectedWeek/advance/setWeek |
| Modify | `src/hooks/useRecords.js` | Pass `week_number` in `add()` |
| Modify | `src/hooks/useAdmin.js` | Expose stored `password` for use by useWeek's advance |
| Modify | `src/App.jsx` | Integrate useWeek, add WeekSelector/NextWeekButton/WeekSummaryTable, gate InputForm |

---

## Task 1: SQL Migration Script

**Files:**
- Create: `supabase-schema-week.sql`

- [ ] **Step 1: Write the migration SQL file**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase-schema-week.sql
git commit -m "feat(db): add week_number column, app_state table, and week RPCs"
```

---

## Task 2: useAdmin — Expose Password

**Files:**
- Modify: `src/hooks/useAdmin.js:35`

The `password` state is already stored internally. We just need to include it in the return value so `useWeek` can call `advance_week(password)`.

- [ ] **Step 1: Modify useAdmin return**

Change line 35 from:
```js
  return { isAdmin, costs, login, logout, updateCost }
```
to:
```js
  return { isAdmin, costs, password, login, logout, updateCost }
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAdmin.js
git commit -m "feat(useAdmin): expose password for week RPC calls"
```

---

## Task 3: useWeek Hook

**Files:**
- Create: `src/hooks/useWeek.js`

- [ ] **Step 1: Create useWeek.js**

```js
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const POLL_INTERVAL_MS = 30_000

export function useWeek() {
  const [currentWeek, setCurrentWeek] = useState(null)
  const [selectedWeek, setSelectedWeek] = useState(null)

  useEffect(() => {
    let cancelled = false

    const tick = () => {
      supabase
        .from('app_state')
        .select('current_week')
        .eq('id', 1)
        .single()
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) {
            console.warn('[useWeek] fetch failed:', error.message)
            return
          }
          setCurrentWeek(data.current_week)
          setSelectedWeek(prev => prev ?? data.current_week)
        })
    }

    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const advance = useCallback(async (password) => {
    const { data, error } = await supabase.rpc('advance_week', { password })
    if (error) throw error
    setCurrentWeek(data)
    setSelectedWeek(data)
    return data
  }, [])

  const setWeek = useCallback(async (password, week) => {
    const { data, error } = await supabase.rpc('set_current_week', {
      password,
      p_week: week,
    })
    if (error) throw error
    setCurrentWeek(data)
    setSelectedWeek(data)
    return data
  }, [])

  return { currentWeek, selectedWeek, setSelectedWeek, advance, setWeek }
}
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWeek.js
git commit -m "feat(useWeek): add hook for week state polling and advance RPC"
```

---

## Task 4: useRecords — Accept week_number in add()

**Files:**
- Modify: `src/hooks/useRecords.js:32-41`

- [ ] **Step 1: Modify the add callback**

The `add` function already accepts an arbitrary object and passes it to Supabase insert. The caller (`handleSubmit` in App.jsx) will include `week_number` in the object. No change needed to `useRecords.js` itself — the field passes through.

Verify by reading line 32-40: `add` does `supabase.from('records').insert(newRecord)` — any field in `newRecord` gets inserted. Since `week_number` has a default in the DB, it will work even without the field, but we'll explicitly pass it from App.

**No code change needed here.** Move to next task.

---

## Task 5: App.jsx — Integrate useWeek and Add UI Components

**Files:**
- Modify: `src/App.jsx`

This is the largest task. We'll add: WeekSelector, NextWeekButton, WeekSummaryTable inline in App.jsx (they're small, single-use components — same pattern as existing InputForm/RecordList/Summary).

- [ ] **Step 1: Add useWeek import and hook call**

At the top of App.jsx, add to imports:
```js
import { useWeek } from './hooks/useWeek'
```

Inside `App()`, after the existing hook calls (line ~383), add:
```js
  const { currentWeek, selectedWeek, setSelectedWeek, advance } = useWeek()
```

- [ ] **Step 2: Filter records by selectedWeek for state computation**

Replace the existing `state` useMemo (lines 385-395):
```js
  const state = useMemo(() => {
    const s = {}
    CONTAINERS.forEach(c => { s[c.name] = { cbm: 0, kg: 0, revenue: 0 } })
    records.filter(r => r.week_number === selectedWeek).forEach(r => {
      if (!s[r.container]) return
      s[r.container].cbm     += Number(r.cbm)
      s[r.container].kg      += Number(r.kg)
      s[r.container].revenue += Number(r.revenue)
    })
    return s
  }, [records, selectedWeek])
```

- [ ] **Step 3: Pass week_number in handleSubmit**

Change `handleSubmit` to include `week_number`:
```js
  const handleSubmit = useCallback(async (salesperson, container, cbm, kg, revenue) => {
    await add({ salesperson, container, cbm, kg, revenue, client_id: clientId, week_number: currentWeek })
  }, [add, clientId, currentWeek])
```

- [ ] **Step 4: Compute weeksWithData set**

Add after the `state` useMemo:
```js
  const weeksWithData = useMemo(() => {
    const s = new Set()
    records.forEach(r => { if (r.week_number) s.add(r.week_number) })
    return s
  }, [records])
```

- [ ] **Step 5: Add WeekSelector component**

Add this component before the `App` function (after `Summary`):
```jsx
function WeekSelector({ selectedWeek, currentWeek, weeksWithData, onChange }) {
  return (
    <select
      value={selectedWeek ?? ''}
      onChange={e => onChange(Number(e.target.value))}
      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
    >
      {Array.from({ length: 52 }, (_, i) => i + 1).map(w => (
        <option key={w} value={w} className={weeksWithData.has(w) ? 'text-red-600 font-semibold' : 'text-gray-400'}>
          Wk{w}{w === currentWeek ? ' (本周)' : ''}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 6: Add NextWeekButton component**

Add after WeekSelector:
```jsx
function NextWeekButton({ currentWeek, password, onAdvance }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await onAdvance(password)
      setConfirming(false)
    } catch (e) {
      alert('推进失败:' + e.message)
    }
    setBusy(false)
  }

  return (
    <>
      <button onClick={() => setConfirming(true)}
        className="text-xs text-orange-600 hover:text-orange-800 border border-orange-200 px-3 py-1.5 rounded-lg mr-2">
        进入下一周
      </button>
      {confirming && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-20" onClick={() => setConfirming(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-lg p-6 w-80">
            <h3 className="text-base font-semibold text-gray-800 mb-3">确认进入下一周</h3>
            <p className="text-sm text-gray-600 mb-4">
              确定从 Wk{currentWeek} 进入 Wk{currentWeek + 1} 吗?Wk{currentWeek} 数据将归档保留。
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">取消</button>
              <button onClick={handleConfirm} disabled={busy}
                className="text-xs bg-orange-600 hover:bg-orange-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50">
                {busy ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 7: Add WeekSummaryTable component**

Add after NextWeekButton:
```jsx
function WeekSummaryTable({ records, costs, isAdmin, onSelectWeek }) {
  const weekGroups = useMemo(() => {
    const groups = {}
    records.forEach(r => {
      if (!r.week_number) return
      if (!groups[r.week_number]) groups[r.week_number] = { cbm: 0, kg: 0, revenue: 0 }
      groups[r.week_number].cbm     += Number(r.cbm)
      groups[r.week_number].kg      += Number(r.kg)
      groups[r.week_number].revenue += Number(r.revenue)
    })
    return groups
  }, [records])

  const capCBM  = CONTAINERS.reduce((s, c) => s + c.capacityCBM, 0)
  const capKG   = CONTAINERS.reduce((s, c) => s + c.capacityKG, 0)
  const totalCost = isAdmin && costs ? CONTAINERS.reduce((s, c) => s + (costs[c.name] || 0), 0) : 0

  const weeks = Object.keys(weekGroups).map(Number).sort((a, b) => a - b)

  if (weeks.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mt-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">周汇总</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">周</th>
              <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">总装载率</th>
              <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">总重量率</th>
              <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">总收入率</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => {
              const g = weekGroups[w]
              const loadRate = g.cbm / capCBM
              const weightRate = g.kg / capKG
              const revenueRate = totalCost > 0 ? g.revenue / totalCost : null
              return (
                <tr key={w} onClick={() => onSelectWeek(w)}
                  className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors">
                  <td className="py-2 px-3 font-medium text-gray-800">Wk{w}</td>
                  <td className={`py-2 px-3 text-center font-medium ${loadRate >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                    {(loadRate * 100).toFixed(1)}%
                  </td>
                  <td className={`py-2 px-3 text-center font-medium ${weightRate >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                    {(weightRate * 100).toFixed(1)}%
                  </td>
                  <td className={`py-2 px-3 text-center font-medium ${revenueRate === null ? 'text-gray-400' : revenueRate >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                    {revenueRate === null ? '--' : `${(revenueRate * 100).toFixed(1)}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Update Summary component — add WeekSelector to header**

Replace the Summary component's opening `<div>` and `<h3>`:
```jsx
function Summary({ state, costs, selectedWeek, currentWeek, weeksWithData, onWeekChange }) {
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
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-800">数据汇总</h3>
        <WeekSelector
          selectedWeek={selectedWeek}
          currentWeek={currentWeek}
          weeksWithData={weeksWithData}
          onChange={onWeekChange}
        />
      </div>
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

- [ ] **Step 9: Update InputForm — disable when viewing history**

Add a `disabled` prop to InputForm. Wrap the form content:
```jsx
function InputForm({ onSubmit, disabled, currentWeek, selectedWeek }) {
```

At the top of the form (inside `<form>`, before the grid), add:
```jsx
      {disabled && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-4 text-xs text-yellow-700">
          查看历史 (Wk{selectedWeek}),录入功能仅在 Wk{currentWeek} (本周) 可用
        </div>
      )}
```

Change the submit button to respect `disabled`:
```jsx
        <button type="submit" disabled={disabled || !currentWeek}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {!currentWeek ? '加载中...' : '添加'}
        </button>
```

- [ ] **Step 10: Update App render — wire everything together**

Replace the header section to include NextWeekButton:
```jsx
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">⚓ 海运拼箱 Dashboard</h1>
            <p className="text-xs text-gray-400">实时追踪柜子装载、重量与收入情况</p>
          </div>
          <div className="flex items-center">
            {isAdmin && <NextWeekButton currentWeek={currentWeek} password={password} onAdvance={advance} />}
            <AdminButton isAdmin={isAdmin} onLogin={login} onLogout={logout} />
          </div>
        </div>
      </header>
```

Update the `App` destructuring to get `password` from useAdmin:
```js
  const { isAdmin, costs, password, login, logout, updateCost } = useAdmin()
```

Update the InputForm usage:
```jsx
          <div><InputForm onSubmit={handleSubmit} disabled={selectedWeek !== currentWeek} currentWeek={currentWeek} selectedWeek={selectedWeek} /></div>
```

Update the Summary usage:
```jsx
        <div className="mb-6">
          <Summary
            state={state}
            costs={isAdmin ? costs : null}
            selectedWeek={selectedWeek}
            currentWeek={currentWeek}
            weeksWithData={weeksWithData}
            onWeekChange={setSelectedWeek}
          />
        </div>
```

Add WeekSummaryTable after the container cards grid:
```jsx
        <WeekSummaryTable
          records={records}
          costs={isAdmin ? costs : null}
          isAdmin={isAdmin}
          onSelectWeek={setSelectedWeek}
        />
```

- [ ] **Step 11: Verify lint passes**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 12: Verify build passes**

Run: `npm run build`
Expected: successful build to dist/

- [ ] **Step 13: Commit**

```bash
git add src/hooks/useWeek.js src/hooks/useAdmin.js src/App.jsx
git commit -m "feat: add weekly archive with week selector, next-week button, and summary table"
```

---

## Task 6: Manual Verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify in browser**

Open the app and check:
1. Summary section shows "数据汇总" with a Wk dropdown on the right
2. Default selected week matches current ISO week
3. Adding a record → that week turns red in the dropdown
4. Switching to a different week → Summary and ContainerCards update, InputForm shows yellow disabled banner
5. Log in as admin → "进入下一周" button appears in header
6. Click "进入下一周" → confirmation modal → confirm → week advances, page shows new empty week
7. Switch back to previous week in dropdown → old data still there
8. WeekSummaryTable at bottom shows all weeks with data, click a row to switch
9. Log out admin → "进入下一周" button disappears, 收入率 column in table shows "--"

---

## Deployment Note

After merging the code, the user must run `supabase-schema-week.sql` in Supabase SQL Editor before the new features will work. The existing `records` rows will get `week_number = 1` (the column default). The `app_state` row will be initialized to the current ISO week at execution time.
