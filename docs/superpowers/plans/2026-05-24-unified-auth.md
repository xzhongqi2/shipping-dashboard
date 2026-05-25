# Unified Auth + Invite + DDP Cloud Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase magic-link auth across three sites (主页 / shipping / DDP) with two roles (`staff` for `@starlinkai-logistics.cn` emails, `viewer` for invite-code emails), record audit fields on shipping records, migrate DDP data from localStorage to a new Supabase `shipments` table, and build an invite-management UI.

**Architecture:** Single shared Supabase project. Roles stored in `auth.users.raw_app_meta_data.role`, written by Auth Hook (staff) or `consume_invite` RPC (viewer). RLS partitions `records` (staff only) and `shipments` (staff RW, viewer RO). Each site has its own Supabase client + per-origin session. DDP's localStorage data layer is replaced with Supabase queries and JSONB columns; an invite-code landing flow gates external users.

**Tech Stack:** React 19 + Vite (shipping), static HTML + Supabase JS UMD bundle (主页 + DDP), Supabase Auth (Magic Link) + Postgres RLS + Auth Hooks + RPCs.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `2026-05-12-task-1/supabase-schema-auth.sql` | Audit fields on records, trigger, records RLS |
| Create | `2026-05-12-task-1/supabase-schema-invites.sql` | invites table + create_invite/validate_invite/consume_invite RPCs + Auth Hook |
| Create | `2026-05-12-task-1/supabase-schema-shipments.sql` | shipments table + RLS (staff RW, viewer RO) + audit trigger |
| Create | `2026-05-12-task-1/supabase-seed-shipments.sql` | 5 sample shipments rows |
| Create | `2026-05-12-task-1/src/components/AuthGate.jsx` | shipping: gate app behind Supabase session, role check |
| Create | `2026-05-12-task-1/src/components/InvitePanel.jsx` | shipping: admin invite-management UI |
| Create | `2026-05-12-task-1/src/hooks/useAuthUser.js` | shipping: hook returning current user + role |
| Create | `2026-05-12-task-1/src/hooks/useInvites.js` | shipping: hook to list/create invites |
| Modify | `2026-05-12-task-1/src/main.jsx` | Wrap App in AuthGate |
| Modify | `2026-05-12-task-1/src/hooks/useRecords.js` | Select creator/updater email |
| Modify | `2026-05-12-task-1/src/App.jsx` | Header user badge, record-list creator/updater display, mount InvitePanel |
| Modify | `20260314145618/index.html` | 主页: add login button + modal + Supabase JS + role-aware menu |
| Modify | `ddp-tracking/index.html` | DDP: replace localStorage layer with Supabase, invite landing, role-based UI restrictions |

---

## Deployment Sequence (do in this order)

This is a destructive migration — sequence matters:

1. **Step A** (Tasks 1–4 SQL): run all schema files in Supabase. Requires brief shipping downtime since RLS flips from `anon all access` to `authenticated only`.
2. **Step B** (Tasks 5–10 shipping React code): push to GitHub, Vercel auto-deploys.
3. **Step C** (Task 11 DDP code): push to GitHub, Vercel auto-deploys.
4. **Step D** (Task 12 主页 OSS upload + CDN flush): manual.
5. **Step E** (Task 13): end-to-end verification.

Plan to do Steps A-D in one ~30 minute session, since shipping briefly stops working between A and B.

---

## Task 1: Supabase Dashboard configuration (manual)

- [ ] **Step 1: Configure redirect URLs**

Supabase Dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: `https://starlinkailog.com`
- **Redirect URLs** (one per line):
  ```
  https://starlinkailog.com
  https://starlinkailog.com/*
  https://shipping.starlinkailog.com
  https://shipping.starlinkailog.com/*
  https://ddp.starlinkailog.com
  https://ddp.starlinkailog.com/*
  http://localhost:5173
  http://localhost:5173/*
  ```

Save.

- [ ] **Step 2: Enable Email provider with confirmation**

Authentication → **Providers** → **Email**:

- ✅ Enable Email Provider
- ✅ Confirm email
- Save

- [ ] **Step 3: (Optional) Customize Magic Link email template**

Authentication → **Email Templates** → **Magic Link**:

- Subject: `登录星链智运`
- Body:
  ```html
  <h2>星链智运 · 登录</h2>
  <p>点击下方按钮登录星链智运后台:</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:10px 20px;background:#185FA5;color:white;text-decoration:none;border-radius:6px;">登录</a></p>
  <p style="color:#666;font-size:12px;margin-top:24px;">链接 1 小时内有效。如非本人操作请忽略。</p>
  ```

Save.

---

## Task 2: SQL migration — records audit fields + RLS

**Files:** Create `2026-05-12-task-1/supabase-schema-auth.sql`

- [ ] **Step 1: Write the file**

```sql
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
```

- [ ] **Step 2: Have user run it in SQL Editor**

Tell user to copy/paste contents into Supabase Dashboard → SQL Editor → New query → Run. Expect green success message.

- [ ] **Step 3: Commit**

```bash
cd /Users/vincentxing/WorkBuddy/2026-05-12-task-1
git add supabase-schema-auth.sql
git commit -m "feat(db): records audit fields + staff-only RLS"
```

---

## Task 3: SQL — invites table, RPCs, Auth Hook

**Files:** Create `2026-05-12-task-1/supabase-schema-invites.sql`

- [ ] **Step 1: Write the file**

```sql
-- ════════════════════════════════════════════
-- 邀请码 + Auth Hook
-- ════════════════════════════════════════════

create table if not exists public.invites (
  code        text primary key,
  email       text not null,
  role        text not null default 'viewer'
              check (role in ('viewer')),
  scope       text not null default 'ddp',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days'),
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete set null
);

create index if not exists idx_invites_email on public.invites(lower(email));

alter table public.invites enable row level security;

drop policy if exists "staff manage invites" on public.invites;
create policy "staff manage invites" on public.invites
  for all to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'staff')
  with check (auth.jwt()->'app_metadata'->>'role' = 'staff');

-- 生成邀请码
create or replace function public.create_invite(target_email text)
returns table (code text, expires_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
declare
  new_code text;
  exp timestamptz;
  uid uuid;
begin
  uid := auth.uid();
  if (auth.jwt()->'app_metadata'->>'role') is distinct from 'staff' then
    raise exception 'only staff can create invites';
  end if;

  new_code := replace(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', ''), '/', ''), '=', '');
  exp := now() + interval '30 days';

  insert into public.invites (code, email, created_by, expires_at)
    values (new_code, lower(target_email), uid, exp);

  return query select new_code, exp;
end;
$$;
grant execute on function public.create_invite(text) to authenticated;

-- 校验邀请码(发 magic link 之前)
create or replace function public.validate_invite(p_code text, p_email text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  inv public.invites;
begin
  select * into inv from public.invites where code = p_code;
  if not found then return false; end if;
  if inv.used_at is not null then return false; end if;
  if inv.expires_at < now() then return false; end if;
  if lower(inv.email) <> lower(p_email) then return false; end if;
  return true;
end;
$$;
grant execute on function public.validate_invite(text, text) to anon, authenticated;

-- 消费邀请码 + 提升 viewer
create or replace function public.consume_invite(p_code text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  inv public.invites;
  uid uuid;
  current_email text;
begin
  uid := auth.uid();
  if uid is null then return false; end if;

  select * into inv from public.invites where code = p_code;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    return false;
  end if;

  select email into current_email from auth.users where id = uid;
  if lower(inv.email) <> lower(current_email) then return false; end if;

  update public.invites
    set used_at = now(), used_by = uid
    where code = p_code;

  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                            || jsonb_build_object('role', 'viewer')
    where id = uid;

  return true;
end;
$$;
grant execute on function public.consume_invite(text) to authenticated;

-- Auth Hook: 白名单 + 邀请码双通道
create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  email text;
  has_invite boolean;
begin
  email := lower(event->'claims'->>'email');

  if email ~* '@starlinkai-logistics\.cn$' then
    return jsonb_set(
      event,
      '{claims,app_metadata,role}',
      to_jsonb('staff'::text)
    );
  end if;

  select exists (
    select 1 from public.invites
    where lower(invites.email) = email
      and used_at is null
      and expires_at > now()
  ) into has_invite;

  if has_invite then
    return event;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', '此邮箱无访问权限。请联系管理员获取邀请,或使用公司邮箱登录'
    )
  );
end;
$$;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
```

- [ ] **Step 2: Have user run it in SQL Editor**

Same as Task 2 Step 2.

- [ ] **Step 3: Have user bind the Auth Hook**

Authentication → **Hooks** → **Before User Created Hook**:

- Hook type: `Postgres function`
- Schema: `public`
- Function: `before_user_created`
- ✅ Enable → Create hook

- [ ] **Step 4: Verify hook with non-whitelisted email**

In Supabase Dashboard → Authentication → Users → click **Add user** → enter `test@gmail.com` → submit.

Expected: error "此邮箱无访问权限...". If it succeeds, hook isn't bound.

- [ ] **Step 5: Commit**

```bash
git add supabase-schema-invites.sql
git commit -m "feat(db): invites table, RPCs, Auth Hook supporting staff/viewer dual-channel"
```

---

## Task 4: SQL — shipments table + seed data

**Files:**
- Create `2026-05-12-task-1/supabase-schema-shipments.sql`
- Create `2026-05-12-task-1/supabase-seed-shipments.sql`

- [ ] **Step 1: Write shipments schema file**

```sql
-- ════════════════════════════════════════════
-- DDP shipments 表
-- ════════════════════════════════════════════

create table if not exists public.shipments (
  id            uuid primary key default gen_random_uuid(),
  booking       text,
  container     text,
  shipper       text,
  consignee     text,
  origin_port   text,
  dest_port     text,
  goods         text,
  ctns          numeric default 0,
  volume        numeric default 0,
  weight        numeric default 0,
  dept          text,
  details       jsonb not null default '{}'::jsonb,
  nodes         jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_shipments_created on public.shipments(created_at desc);
create index if not exists idx_shipments_container on public.shipments(container);

drop trigger if exists trg_shipments_audit on public.shipments;
create trigger trg_shipments_audit
  before insert or update on public.shipments
  for each row execute function public.set_audit_fields();

alter table public.shipments enable row level security;

drop policy if exists "staff full access shipments" on public.shipments;
create policy "staff full access shipments" on public.shipments
  for all to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'staff')
  with check (auth.jwt()->'app_metadata'->>'role' = 'staff');

drop policy if exists "viewer read shipments" on public.shipments;
create policy "viewer read shipments" on public.shipments
  for select to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'viewer');
```

- [ ] **Step 2: Write seed file** (5 sample rows extracted from DDP HTML's `sampleData`)

```sql
-- ════════════════════════════════════════════
-- DDP shipments 示例数据(首次部署运行一次)
-- ════════════════════════════════════════════

insert into public.shipments (booking, container, shipper, consignee, origin_port, dest_port, goods, ctns, volume, weight, dept, details, nodes) values
('SZ-YT-20250508-001', 'MSCU8765432', '深圳市星链智运科技有限公司', 'ABC IMPORT CORP', '深圳盐田', '洛杉矶', '电子配件 / Electronic Components', 240, 14.5, 4200, '操作部',
 '{"seal":"SL20250501","shipperAddr":"深圳市南山区科技园","consigneeAddr":"123 Commerce St, Los Angeles, CA 90001","factoryName":"深圳市金鑫电子厂","factoryAddr":"深圳市龙华区大浪街道金鑫工业园A栋","factoryContact":"李经理 138-0755-0001","tempContainer":"TMP-YT-2025-0501","destCity":"Los Angeles, CA","destAddr":"456 Logistics Blvd, LA, CA"}',
 '{"booking":{"status":"done","date":"2025-05-08","note":"已确认舱位"},"truck_pickup":{"status":"done","date":"2025-05-10","note":""},"stuffing":{"status":"done","date":"2025-05-10","note":"装柜完成"},"cy_entry":{"status":"done","date":"2025-05-11","note":""},"exp_customs":{"status":"done","date":"2025-05-11","note":""},"exp_clearance":{"status":"done","date":"2025-05-11","note":"放行"},"sailing":{"status":"done","date":"2025-05-12","note":""},"eta":{"status":"progress","date":"","note":"ETA: 2025-05-28"},"ocean_track":{"status":"progress","date":"","note":"航行中"},"arrival":{"status":"pending","date":"","note":""},"arrival_date":{"status":"pending","date":"","note":""},"imp_customs":{"status":"pending","date":"","note":""},"imp_clearance":{"status":"pending","date":"","note":""},"dray":{"status":"pending","date":"","note":""},"delivery":{"status":"pending","date":"","note":""},"pod":{"status":"pending","date":"","note":""}}'),
('SZ-YT-20250505-002', 'CMAU2345678', '深圳市星链智运科技有限公司', 'XYZ TRADING LLC', '深圳盐田', '纽约', '家居用品 / Home Goods', 380, 22.0, 6800, '报关部',
 '{"seal":"SL20250502","shipperAddr":"深圳市南山区科技园","consigneeAddr":"789 Harbor Dr, New York, NY 10001","factoryName":"东莞华昌玩具厂","factoryAddr":"东莞市长安镇乌沙社区振安路22号","factoryContact":"王主管 139-0769-1234","tempContainer":"TMP-YT-2025-0502","destCity":"New York, NY","destAddr":"789 Harbor Dr, NY, NY 10001"}',
 '{"booking":{"status":"done","date":"2025-05-05","note":""},"truck_pickup":{"status":"done","date":"2025-05-06","note":""},"stuffing":{"status":"done","date":"2025-05-07","note":""},"cy_entry":{"status":"done","date":"2025-05-08","note":""},"exp_customs":{"status":"done","date":"2025-05-08","note":""},"exp_clearance":{"status":"done","date":"2025-05-08","note":"正常放行"},"sailing":{"status":"done","date":"2025-05-09","note":""},"eta":{"status":"progress","date":"","note":"ETA: 2025-06-05"},"ocean_track":{"status":"progress","date":"","note":"航行中 · 太平洋"},"arrival":{"status":"pending","date":"","note":""},"arrival_date":{"status":"pending","date":"","note":""},"imp_customs":{"status":"pending","date":"","note":""},"imp_clearance":{"status":"pending","date":"","note":""},"dray":{"status":"pending","date":"","note":""},"delivery":{"status":"pending","date":"","note":""},"pod":{"status":"pending","date":"","note":""}}');
-- 实施时,从 ddp-tracking/index.html 的 sampleData 数组提取剩余 3 条以同样格式补齐
```

> **Note for implementer:** Read `/Users/vincentxing/WorkBuddy/ddp-tracking/index.html` lines 711-915 (the `sampleData` array). Convert each remaining record to a SQL row in the format above. Do NOT skip — having seed data is essential for the deployed DDP page to look populated.

- [ ] **Step 3: Have user run schema first, then seed**

Tell user:
1. Run `supabase-schema-shipments.sql` first
2. Then run `supabase-seed-shipments.sql`

- [ ] **Step 4: Commit**

```bash
git add supabase-schema-shipments.sql supabase-seed-shipments.sql
git commit -m "feat(db): shipments table for DDP cloud migration + sample seed"
```

---

## Task 5: shipping — useAuthUser hook

**Files:** Create `2026-05-12-task-1/src/hooks/useAuthUser.js`

- [ ] **Step 1: Create the hook**

```js
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuthUser() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const role = user?.app_metadata?.role ?? null
  return { user, role, loading }
}
```

- [ ] **Step 2: Verify lint**

```bash
cd /Users/vincentxing/WorkBuddy/2026-05-12-task-1 && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAuthUser.js
git commit -m "feat(shipping): add useAuthUser hook with role"
```

---

## Task 6: shipping — AuthGate (with role check)

**Files:** Create `2026-05-12-task-1/src/components/AuthGate.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthUser } from '../hooks/useAuthUser'

const ALLOWED_DOMAIN = '@starlinkai-logistics.cn'

export function AuthGate({ children }) {
  const { user, role, loading } = useAuthUser()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">加载中...</div>
  }

  // staff 进入,其他用户(viewer 或无 role)看到无权限页
  if (user && role === 'staff') return children

  if (user && role !== 'staff') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-800 mb-2">无访问权限</h1>
          <p className="text-sm text-gray-600 mb-6">此页面仅限内部员工访问。如需查看 DDP 物流跟踪,请使用您收到的邀请链接。</p>
          <button onClick={() => supabase.auth.signOut()}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-4 py-2 rounded-lg">
            退出登录
          </button>
        </div>
      </div>
    )
  }

  const handleSend = async (e) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!email.trim().toLowerCase().endsWith(ALLOWED_DOMAIN)) {
      setErr(`仅 ${ALLOWED_DOMAIN} 邮箱可登录`)
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg(`已发送登录链接到 ${email.trim()},请到邮箱点链接完成登录`)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-md">
        <h1 className="text-xl font-bold text-gray-800 mb-2">星链智运 · 内部登录</h1>
        <p className="text-sm text-gray-500 mb-6">请使用公司邮箱登录</p>
        <form onSubmit={handleSend}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder={`name${ALLOWED_DOMAIN}`}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3"
            required />
          {err && <p className="text-sm text-red-500 mb-3">{err}</p>}
          {msg && <p className="text-sm text-green-600 mb-3">{msg}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg">
            {busy ? '发送中...' : '发送登录链接'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-5 text-center">仅 {ALLOWED_DOMAIN} 邮箱可登录</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint + commit**

```bash
npm run lint
git add src/components/AuthGate.jsx
git commit -m "feat(shipping): AuthGate with role check (staff only)"
```

---

## Task 7: shipping — wire AuthGate into main.jsx

**Files:** Modify `2026-05-12-task-1/src/main.jsx`

- [ ] **Step 1: Read current main.jsx**

```bash
cat /Users/vincentxing/WorkBuddy/2026-05-12-task-1/src/main.jsx
```

- [ ] **Step 2: Wrap App**

Replace the file content with:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthGate } from './components/AuthGate.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
)
```

- [ ] **Step 3: Build to verify**

```bash
npm run build
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/main.jsx
git commit -m "feat(shipping): gate app behind AuthGate"
```

---

## Task 8: shipping — useInvites hook + InvitePanel UI

**Files:**
- Create `2026-05-12-task-1/src/hooks/useInvites.js`
- Create `2026-05-12-task-1/src/components/InvitePanel.jsx`

- [ ] **Step 1: Create useInvites hook**

```js
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useInvites() {
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('invites')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error) setInvites(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (email) => {
    const { data, error } = await supabase.rpc('create_invite', { target_email: email })
    if (error) throw error
    await refresh()
    return data?.[0]
  }, [refresh])

  return { invites, loading, refresh, create }
}
```

- [ ] **Step 2: Create InvitePanel component**

```jsx
import { useState } from 'react'
import { useInvites } from '../hooks/useInvites'

const DDP_BASE = 'https://ddp.starlinkailog.com'

function buildInviteUrl(code) {
  return `${DDP_BASE}/?invite=${encodeURIComponent(code)}`
}

function statusOf(inv) {
  if (inv.used_at) return { label: '已使用', color: 'text-gray-400' }
  if (new Date(inv.expires_at) < new Date()) return { label: '已过期', color: 'text-red-500' }
  return { label: '未使用', color: 'text-green-600' }
}

export function InvitePanel() {
  const { invites, loading, create } = useInvites()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setMsg(''); setBusy(true)
    try {
      const inv = await create(email.trim())
      setEmail('')
      setMsg(`邀请已生成,链接已复制: ${buildInviteUrl(inv.code)}`)
      navigator.clipboard?.writeText(buildInviteUrl(inv.code))
    } catch (err) {
      setMsg('生成失败:' + err.message)
    }
    setBusy(false)
  }

  const copy = (code) => navigator.clipboard?.writeText(buildInviteUrl(code))

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">邀请码 · DDP 只读访客</h3>
      <form onSubmit={submit} className="flex gap-2 mb-4">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="访客邮箱"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" required />
        <button type="submit" disabled={busy}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg">
          {busy ? '...' : '生成邀请链接'}
        </button>
      </form>
      {msg && <p className="text-xs text-gray-500 mb-3 break-all">{msg}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">加载中...</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-gray-400">暂无邀请记录</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-2 text-xs text-gray-500 font-medium">邮箱</th>
              <th className="text-left py-2 px-2 text-xs text-gray-500 font-medium">生成时间</th>
              <th className="text-left py-2 px-2 text-xs text-gray-500 font-medium">过期时间</th>
              <th className="text-center py-2 px-2 text-xs text-gray-500 font-medium">状态</th>
              <th className="text-center py-2 px-2 text-xs text-gray-500 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {invites.map(inv => {
              const s = statusOf(inv)
              return (
                <tr key={inv.code} className="border-b border-gray-50">
                  <td className="py-2 px-2">{inv.email}</td>
                  <td className="py-2 px-2 text-gray-500">{new Date(inv.created_at).toLocaleDateString('zh-CN')}</td>
                  <td className="py-2 px-2 text-gray-500">{new Date(inv.expires_at).toLocaleDateString('zh-CN')}</td>
                  <td className={`py-2 px-2 text-center ${s.color}`}>{s.label}</td>
                  <td className="py-2 px-2 text-center">
                    <button onClick={() => copy(inv.code)}
                      className="text-xs text-blue-600 hover:text-blue-800">复制链接</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/hooks/useInvites.js src/components/InvitePanel.jsx
git commit -m "feat(shipping): invite-management hook and panel"
```

---

## Task 9: shipping — header user badge, mount InvitePanel, RecordList creator/updater

**Files:** Modify `2026-05-12-task-1/src/App.jsx`

- [ ] **Step 1: Add imports**

After existing import `import { useAdmin } from './hooks/useAdmin'`, insert:

```jsx
import { useAuthUser } from './hooks/useAuthUser'
import { supabase } from './lib/supabase'
import { InvitePanel } from './components/InvitePanel'
```

- [ ] **Step 2: Add UserBadge component before `export default function App()`**

```jsx
function UserBadge() {
  const { user } = useAuthUser()
  if (!user) return null
  const prefix = user.email.split('@')[0]
  return (
    <div className="flex items-center gap-2 mr-2">
      <span className="text-xs text-gray-500" title={user.email}>@{prefix}</span>
      <button onClick={() => supabase.auth.signOut()}
        className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg">
        退出
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Render UserBadge in header**

Find the header's flex container (with `<NextWeekButton>` and `<AdminButton>`):

Replace:
```jsx
          <div className="flex items-center">
            {isAdmin && <NextWeekButton currentWeek={currentWeek} password={password} onAdvance={advance} />}
            <AdminButton isAdmin={isAdmin} onLogin={login} onLogout={logout} />
          </div>
```

With:
```jsx
          <div className="flex items-center">
            <UserBadge />
            {isAdmin && <NextWeekButton currentWeek={currentWeek} password={password} onAdvance={advance} />}
            <AdminButton isAdmin={isAdmin} onLogin={login} onLogout={logout} />
          </div>
```

- [ ] **Step 4: Mount InvitePanel inside admin section**

Find:
```jsx
        {isAdmin && <CostConfigPanel costs={costs} onUpdate={updateCost} />}
```

Replace with:
```jsx
        {isAdmin && <CostConfigPanel costs={costs} onUpdate={updateCost} />}
        {isAdmin && <InvitePanel />}
```

- [ ] **Step 5: Build to verify**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(shipping): user badge in header + invite panel for admins"
```

---

## Task 10: shipping — display creator/updater on records

**Files:**
- Modify `2026-05-12-task-1/src/hooks/useRecords.js`
- Modify `2026-05-12-task-1/src/App.jsx`

- [ ] **Step 1: Update useRecords selects**

Edit `/Users/vincentxing/WorkBuddy/2026-05-12-task-1/src/hooks/useRecords.js`.

Replace `.select('*')` (in the `tick` function) with:
```js
.select('*, creator:created_by(email), updater:updated_by(email)')
```

In `add`:
```js
.insert(newRecord)
.select('*, creator:created_by(email), updater:updated_by(email)')
.single()
```

In `update`:
```js
.update(patch)
.eq('id', id)
.select('*, creator:created_by(email), updater:updated_by(email)')
.single()
```

- [ ] **Step 2: Render creator/updater in RecordList**

In `App.jsx`, find the view-mode `<div className="grid grid-cols-3 gap-4 text-xs text-gray-500">` block in `RecordList`. Right after that grid `</div>`, add:

```jsx
                <div className="text-xs text-gray-400 mt-1.5">
                  创建:{r.creator?.email ? '@' + r.creator.email.split('@')[0] : '未知'}
                  {r.updater && r.updater.email && r.updater.email !== r.creator?.email && (
                    <> · 修改:@{r.updater.email.split('@')[0]}</>
                  )}
                </div>
```

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/hooks/useRecords.js src/App.jsx
git commit -m "feat(shipping): show creator/updater email prefix on records"
```

---

## Task 11: DDP — full migration to Supabase + invite landing + role-based UI

**Files:** Modify `/Users/vincentxing/WorkBuddy/ddp-tracking/index.html`

This is the largest task. Approach: do it in multiple commits inside this single file.

- [ ] **Step 1: Add Supabase SDK**

Find `</head>` near top of file. Right before it, add:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

- [ ] **Step 2: Identify and delete legacy login overlay HTML**

Run:
```bash
grep -n "login-overlay\|login-screen\|setup-panel" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

Find the contiguous `<div class="login-overlay" id="login-screen">…</div>` block. Delete it entirely.

- [ ] **Step 3: Delete legacy login CSS**

In the `<style>` block, find every rule starting `.login-` and the related `.setup-` rules. Delete each line.

```bash
grep -n "^    \.login-\|^    \.setup-" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

- [ ] **Step 4: Delete legacy auth JS**

Find `// ===== 认证系统 =====` (around line 525) and delete from there through `showLoginPanel`'s closing `}`. Also remove `simpleHash`, `getUsers`, `saveUsers`, `getSession`, `setSession`, `clearSession`. Stop deleting before `loadData` / `apiCall` / `renderTable`.

Verify nothing remains:
```bash
grep -n "AUTH_KEY\|USERS_KEY\|getUsers\|simpleHash\|showLoginScreen\|showSetupPanel\|showLoginPanel" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```
Expected: no matches.

- [ ] **Step 5: Delete legacy `apiCall` and localStorage data layer**

Find:
- `const API_BASE = ...`
- `const USE_API = ...`
- `let _syncStatus = ...`
- `function setSyncStatus(...)`
- `async function apiCall(...)`
- `let shipmentData = []`
- `let _dataLoaded = false`
- `async function loadData() { ... }`
- `async function saveDataToApi(...)`
- the `(function checkApiHealth() ...)` IIFE
- `const sampleData = [ ... ]` (the entire array literal)

Delete all of them. Reason: replaced by Supabase calls in Step 7.

- [ ] **Step 6: Replace `let shipmentData = []` with a clean declaration**

After the deletions, just keep this single line where the data variable used to live:
```js
let shipmentData = []
```

- [ ] **Step 7: Add the new Supabase + auth + data layer**

In the main `<script>` block at the bottom of `<body>`, at the very top of the script, insert:

```js
// ===== Supabase Client =====
const SUPABASE_URL = 'https://jqowxpcicqxbwubmowgr.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_HGioZE--7_zSapBl-JfuoQ_tiRknMvD'
const ALLOWED_DOMAIN = '@starlinkai-logistics.cn'
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ===== Auth state =====
let _authUser = null
let _authRole = null  // 'staff' | 'viewer' | null

// ===== URL helpers =====
function getInviteCode() {
  return new URLSearchParams(location.search).get('invite')
}
function clearInviteFromUrl() {
  const url = new URL(location.href)
  url.searchParams.delete('invite')
  history.replaceState({}, '', url)
}

// ===== Auth Gate UI =====
function renderAuthGate(opts = {}) {
  const inviteCode = opts.inviteCode || ''
  const inviteHint = inviteCode
    ? `<div style="background:#E6F1FB;border:1px solid #B5D4F4;color:#185FA5;font-size:12px;padding:8px 12px;border-radius:6px;margin-bottom:14px;">您正在使用邀请链接,请输入收到邀请的邮箱</div>`
    : ''
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#F1F0EC;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;padding:20px;">
      <div style="background:white;border-radius:16px;padding:40px 36px;width:100%;max-width:380px;box-shadow:0 24px 80px rgba(0,0,0,.15);">
        <h1 style="font-size:20px;font-weight:700;color:#185FA5;margin:0 0 6px;">DDP 跟踪 · 登录</h1>
        <p style="font-size:13px;color:#666;margin:0 0 20px;">请输入邮箱以接收登录链接</p>
        ${inviteHint}
        <div id="auth-msg" style="display:none;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:12px;"></div>
        <input id="auth-email" type="email" placeholder="name@example.com"
          style="width:100%;padding:10px 12px;border:1.5px solid #D5D5D0;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px;" />
        <button id="auth-send" onclick="window.sendAuthLink()"
          style="width:100%;padding:11px;background:#185FA5;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
          发送登录链接
        </button>
        <p style="font-size:11px;color:#888;margin:12px 0 0;text-align:center;">
          公司员工请使用 ${ALLOWED_DOMAIN} 邮箱<br>
          外部访客请使用收到邀请的邮箱
        </p>
      </div>
    </div>
  `
}

function showAuthMsg(text, kind) {
  const el = document.getElementById('auth-msg')
  if (!el) return
  el.style.display = 'block'
  el.style.background = kind === 'err' ? '#FCEBEB' : '#E6F5EC'
  el.style.color = kind === 'err' ? '#C0392B' : '#1A7A3E'
  el.textContent = text
}

window.sendAuthLink = async function () {
  const email = document.getElementById('auth-email').value.trim()
  if (!email) { showAuthMsg('请输入邮箱', 'err'); return }
  const inviteCode = getInviteCode()
  const isCompany = email.toLowerCase().endsWith(ALLOWED_DOMAIN)

  if (!isCompany && !inviteCode) {
    showAuthMsg('非公司邮箱必须通过邀请链接登录', 'err')
    return
  }

  if (inviteCode && !isCompany) {
    const { data: ok, error: vErr } = await sb.rpc('validate_invite', { p_code: inviteCode, p_email: email })
    if (vErr || !ok) { showAuthMsg('邀请码无效、已使用或邮箱不匹配', 'err'); return }
  }

  const btn = document.getElementById('auth-send')
  btn.disabled = true; btn.textContent = '发送中...'
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },  // 保留 ?invite=xxx
  })
  btn.disabled = false; btn.textContent = '发送登录链接'
  if (error) { showAuthMsg(error.message, 'err'); return }
  showAuthMsg('已发送登录链接到 ' + email, 'ok')
}

window.signOut = async function () {
  await sb.auth.signOut()
  location.replace(location.origin + location.pathname)
}

// ===== Data layer =====
function dbToFront(row) {
  return {
    id: row.id,
    booking: row.booking,
    container: row.container,
    seal: row.details?.seal,
    shipper: row.shipper,
    shipperAddr: row.details?.shipperAddr,
    consignee: row.consignee,
    consigneeAddr: row.details?.consigneeAddr,
    factoryName: row.details?.factoryName,
    factoryAddr: row.details?.factoryAddr,
    factoryContact: row.details?.factoryContact,
    tempContainer: row.details?.tempContainer,
    originPort: row.origin_port,
    destPort: row.dest_port,
    destCity: row.details?.destCity,
    destAddr: row.details?.destAddr,
    goods: row.goods,
    ctns: row.ctns,
    volume: row.volume,
    weight: row.weight,
    dept: row.dept,
    nodes: row.nodes || {},
  }
}

function frontToDb(record) {
  return {
    booking: record.booking,
    container: record.container,
    shipper: record.shipper,
    consignee: record.consignee,
    origin_port: record.originPort,
    dest_port: record.destPort,
    goods: record.goods,
    ctns: Number(record.ctns) || 0,
    volume: Number(record.volume) || 0,
    weight: Number(record.weight) || 0,
    dept: record.dept,
    details: {
      seal: record.seal,
      shipperAddr: record.shipperAddr,
      consigneeAddr: record.consigneeAddr,
      factoryName: record.factoryName,
      factoryAddr: record.factoryAddr,
      factoryContact: record.factoryContact,
      tempContainer: record.tempContainer,
      destCity: record.destCity,
      destAddr: record.destAddr,
    },
    nodes: record.nodes || {},
  }
}

async function loadData() {
  const { data, error } = await sb
    .from('shipments')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error('[loadData]', error); return }
  shipmentData = (data || []).map(dbToFront)
}

async function saveDataToApi(record, action) {
  if (action === 'add') {
    const { data, error } = await sb.from('shipments').insert(frontToDb(record)).select().single()
    if (error) throw error
    return data.id
  } else if (action === 'update') {
    const { error } = await sb.from('shipments').update(frontToDb(record)).eq('id', record.id)
    if (error) throw error
  } else if (action === 'delete') {
    const { error } = await sb.from('shipments').delete().eq('id', record.id)
    if (error) throw error
  }
}

// ===== Boot =====
;(async function boot() {
  const { data: { session } } = await sb.auth.getSession()

  // 处理邀请回调:登录成功 + URL 有 invite 参数 → consume
  const inviteCode = getInviteCode()
  if (session && inviteCode) {
    await sb.rpc('consume_invite', { p_code: inviteCode })
    // 重新拉 session,role 已写入 app_metadata
    const { data: refreshed } = await sb.auth.refreshSession()
    if (refreshed?.session) {
      _authUser = refreshed.session.user
      _authRole = refreshed.session.user.app_metadata?.role ?? null
    }
    clearInviteFromUrl()
  } else if (session) {
    _authUser = session.user
    _authRole = session.user.app_metadata?.role ?? null
  }

  if (!_authUser) {
    renderAuthGate({ inviteCode })
    return
  }

  // 已登录但无 role → 异常,显示登录页(诊断信息隐式)
  if (!_authRole) {
    renderAuthGate({ inviteCode })
    return
  }

  // 加载数据并渲染
  await loadData()
  if (typeof renderTable === 'function') {
    applyFilter()  // 触发首次渲染
  }

  // 注入用户徽章 + 按 role 调整 UI
  injectUserBadge()
  if (_authRole === 'viewer') applyViewerRestrictions()
})()

function injectUserBadge() {
  const header = document.querySelector('.app-header .header-actions')
  if (!header || document.getElementById('auth-user-badge')) return
  const span = document.createElement('span')
  span.id = 'auth-user-badge'
  span.style.cssText = 'color:white;font-size:12px;padding:4px 10px;border:1px solid rgba(255,255,255,.3);border-radius:6px;cursor:pointer;'
  span.textContent = '@' + _authUser.email.split('@')[0] + ' · 退出'
  span.onclick = () => window.signOut()
  header.appendChild(span)
}

function applyViewerRestrictions() {
  // 顶部加只读提示
  const banner = document.createElement('div')
  banner.style.cssText = 'background:#FFF3E0;color:#C06800;padding:8px 16px;font-size:12px;text-align:center;border-bottom:1px solid #F5D0A0;'
  banner.textContent = '只读模式 — 您是受邀访客,无法编辑或新增'
  document.body.insertBefore(banner, document.body.firstChild)

  // 隐藏所有写入按钮
  const style = document.createElement('style')
  style.textContent = `
    .btn-primary, .action-btns, [onclick*="addRow"], [onclick*="editRecord"], [onclick*="deleteRecord"] { display: none !important; }
    tbody tr { cursor: default !important; }
  `
  document.head.appendChild(style)

  // 阻止双击编辑
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('tr')) e.stopPropagation()
  }, true)
}
```

- [ ] **Step 8: Wire existing app code to use new data layer**

Find any place that previously called `loadData()` from old code (probably an init at bottom). Make sure now `loadData` is awaited inside `boot()` (already done above). Remove any other init calls.

Also find any setSyncStatus calls in the existing render/handler code. Replace with no-ops (or just delete the calls — the indicator div can stay hidden, won't render):

```bash
grep -n "setSyncStatus" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

For each match: delete the entire line (they're all standalone status calls, no chained logic).

- [ ] **Step 9: Open locally to verify**

```bash
open /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

Expected:
- Page shows new auth gate (centered card)
- `gmail@gmail.com` (no invite) → red error "非公司邮箱必须通过邀请链接登录"
- `?invite=fakecode` in URL → page shows blue invite hint banner; `gmail@gmail.com` → red "邀请码无效"

Open browser DevTools console; should see no errors related to undefined functions.

- [ ] **Step 10: Commit and push**

```bash
cd /Users/vincentxing/WorkBuddy/ddp-tracking
git add index.html
git commit -m "feat: replace localStorage with Supabase, add invite landing, role-based UI"
git push
```

---

## Task 12: 主页 — login modal + role-aware menu

**Files:** Modify `/Users/vincentxing/WorkBuddy/20260314145618/index.html`

- [ ] **Step 1: Add Supabase SDK**

Right before `</head>`:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

- [ ] **Step 2: Add login modal CSS**

After the `.nav-dropdown` rules in the `<style>` block, append:

```css
    .auth-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 9999; align-items: center; justify-content: center; padding: 20px; }
    .auth-modal-overlay.show { display: flex; }
    .auth-modal { background: white; border-radius: 16px; padding: 32px 28px; width: 100%; max-width: 380px; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
    .auth-modal h3 { font-size: 18px; font-weight: 700; color: #185FA5; margin-bottom: 4px; }
    .auth-modal .auth-sub { font-size: 13px; color: #666; margin-bottom: 20px; }
    .auth-modal input { width: 100%; padding: 10px 12px; border: 1.5px solid #D5D5D0; border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-bottom: 12px; }
    .auth-modal input:focus { outline: none; border-color: #185FA5; box-shadow: 0 0 0 3px rgba(24,95,165,.1); }
    .auth-modal button.auth-send { width: 100%; padding: 11px; background: #185FA5; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .auth-modal button.auth-send:hover { background: #144C85; }
    .auth-modal button.auth-send:disabled { opacity: .5; cursor: not-allowed; }
    .auth-modal .auth-hint { font-size: 11px; color: #888; margin-top: 12px; text-align: center; }
    .auth-modal .auth-msg { font-size: 13px; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; }
    .auth-modal .auth-msg.err { background: #FCEBEB; color: #C0392B; }
    .auth-modal .auth-msg.ok { background: #E6F5EC; color: #1A7A3E; }
    .auth-modal .auth-close { float: right; background: none; border: none; cursor: pointer; font-size: 22px; color: #888; line-height: 1; padding: 0 4px; }
    .user-menu { position: relative; }
    .user-menu-btn { padding: 6px 12px; border-radius: 8px; background: rgba(255,255,255,.1); color: white; font-size: 13px; cursor: pointer; border: 1px solid rgba(255,255,255,.2); }
    .user-menu-dropdown { position: absolute; top: calc(100% + 6px); right: 0; min-width: 160px; background: rgba(11,22,40,.97); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px; box-shadow: 0 12px 32px rgba(0,0,0,.4); display: none; z-index: 1000; }
    .user-menu.open .user-menu-dropdown { display: block; }
    .user-menu-item { display: block; padding: 9px 14px; border-radius: 6px; font-size: 13px; color: rgba(255,255,255,.75); cursor: pointer; }
    .user-menu-item:hover { color: #fff; background: rgba(255,255,255,.08); }
```

- [ ] **Step 3: Modify nav: replace the `<div style="display:flex;align-items:center;gap:8px;">` block in `<nav id="navbar">`**

Replace:
```html
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="nav-cta" id="nav-cta-btn" onclick="gp('contact')">立即咨询</span>
      <div class="lang-switch" onclick="toggleLang()" title="Switch Language">
        <span class="lang-opt active" id="lo-zh">中</span>
        <span class="lang-sep">/</span>
        <span class="lang-opt" id="lo-en">EN</span>
      </div>
    </div>
```

With:
```html
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="nav-link" id="auth-login-btn" onclick="openAuthModal()" data-zh="登录" data-en="Sign In">登录</span>
      <div class="user-menu" id="auth-user-menu" style="display:none">
        <span class="user-menu-btn" onclick="toggleUserMenu(event)"><span id="auth-user-prefix"></span> ▾</span>
        <div class="user-menu-dropdown">
          <span class="user-menu-item" id="menu-shipping" onclick="window.open('https://shipping.starlinkailog.com','_blank')">亚马逊拼柜</span>
          <span class="user-menu-item" onclick="window.open('https://ddp.starlinkailog.com','_blank')">DDP</span>
          <span class="user-menu-item" onclick="signOut()" data-zh="退出登录" data-en="Sign Out">退出登录</span>
        </div>
      </div>
      <span class="nav-cta" id="nav-cta-btn" onclick="gp('contact')">立即咨询</span>
      <div class="lang-switch" onclick="toggleLang()" title="Switch Language">
        <span class="lang-opt active" id="lo-zh">中</span>
        <span class="lang-sep">/</span>
        <span class="lang-opt" id="lo-en">EN</span>
      </div>
    </div>
```

- [ ] **Step 4: Add login modal HTML before `</body>`**

```html
<div class="auth-modal-overlay" id="auth-modal" onclick="if(event.target===this)closeAuthModal()">
  <div class="auth-modal">
    <button class="auth-close" onclick="closeAuthModal()">×</button>
    <h3 data-zh="星链智运 · 内部登录" data-en="Starlink · Sign In">星链智运 · 内部登录</h3>
    <p class="auth-sub" data-zh="请使用公司邮箱登录" data-en="Sign in with your company email">请使用公司邮箱登录</p>
    <div id="auth-msg" style="display:none"></div>
    <input type="email" id="auth-email" placeholder="name@starlinkai-logistics.cn" autocomplete="email" />
    <button class="auth-send" id="auth-send-btn" onclick="sendMagicLink()" data-zh="发送登录链接" data-en="Send Magic Link">发送登录链接</button>
    <p class="auth-hint" data-zh="仅 @starlinkai-logistics.cn 邮箱可登录" data-en="Only @starlinkai-logistics.cn emails allowed">仅 @starlinkai-logistics.cn 邮箱可登录</p>
  </div>
</div>
```

- [ ] **Step 5: Add JS at the top of the existing main `<script>` block**

```js
// ===== Supabase Auth =====
const SUPABASE_URL = 'https://jqowxpcicqxbwubmowgr.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_HGioZE--7_zSapBl-JfuoQ_tiRknMvD'
const ALLOWED_DOMAIN = '@starlinkai-logistics.cn'
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function openAuthModal() {
  document.getElementById('auth-modal').classList.add('show')
  document.getElementById('auth-email').value = ''
  document.getElementById('auth-msg').style.display = 'none'
  setTimeout(() => document.getElementById('auth-email').focus(), 50)
}
function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('show')
}
function showAuthMsg(text, kind) {
  const el = document.getElementById('auth-msg')
  el.className = 'auth-msg ' + kind
  el.textContent = text
  el.style.display = 'block'
}
async function sendMagicLink() {
  const email = document.getElementById('auth-email').value.trim()
  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
    showAuthMsg('仅 ' + ALLOWED_DOMAIN + ' 邮箱可登录', 'err')
    return
  }
  const btn = document.getElementById('auth-send-btn')
  btn.disabled = true; btn.textContent = '发送中...'
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
  btn.disabled = false; btn.textContent = '发送登录链接'
  if (error) { showAuthMsg(error.message, 'err'); return }
  showAuthMsg('已发送登录链接到 ' + email + ',请到邮箱点链接', 'ok')
}
async function signOut() {
  await sb.auth.signOut()
  refreshAuthUI()
}
function toggleUserMenu(e) {
  if (e) e.stopPropagation()
  document.getElementById('auth-user-menu').classList.toggle('open')
}
document.addEventListener('click', () => {
  document.getElementById('auth-user-menu')?.classList.remove('open')
})
async function refreshAuthUI() {
  const { data: { user } } = await sb.auth.getUser()
  const loginBtn = document.getElementById('auth-login-btn')
  const userMenu = document.getElementById('auth-user-menu')
  const shippingMenu = document.getElementById('menu-shipping')
  if (user) {
    loginBtn.style.display = 'none'
    userMenu.style.display = 'block'
    document.getElementById('auth-user-prefix').textContent = '@' + user.email.split('@')[0]
    // viewer 隐藏 shipping 入口
    if (shippingMenu) {
      shippingMenu.style.display = (user.app_metadata?.role === 'staff') ? 'block' : 'none'
    }
    closeAuthModal()
  } else {
    loginBtn.style.display = 'inline-block'
    userMenu.style.display = 'none'
  }
}
sb.auth.onAuthStateChange(() => refreshAuthUI())
refreshAuthUI()
```

- [ ] **Step 6: Open locally to verify**

```bash
open /Users/vincentxing/WorkBuddy/20260314145618/index.html
```

- 顶部右上出现"登录"按钮
- 点击 → 弹 modal → `random@gmail.com` → 红字"仅 @starlinkai-logistics.cn 邮箱可登录"
- 关闭 modal,页面正常

- [ ] **Step 7: Tell user to upload + flush CDN**

> 主页改完。请:
> 1. 阿里云 OSS → starlinklog-web bucket → 文件管理 → 删除旧 `index.html` → 上传 `/Users/vincentxing/WorkBuddy/20260314145618/index.html`
> 2. 阿里云 CDN 控制台 → 刷新预热 → URL 刷新:
>    - https://starlinkailog.com/
>    - https://starlinkailog.com/index.html

(主页不在 git 仓库,无 commit。)

---

## Task 13: End-to-end verification (manual)

After Tasks 1–12 complete and shipping/DDP deploys are live + 主页 OSS uploaded:

- [ ] **Step 1: Reject non-whitelisted email on 主页**

https://starlinkailog.com → 登录 → `test@gmail.com` → expect "仅 @starlinkai-logistics.cn 邮箱可登录"

- [ ] **Step 2: Successful staff login**

Input your real `@starlinkai-logistics.cn` email → send → check email → click magic link → returns to 主页 with your `@prefix` badge.

- [ ] **Step 3: shipping login (separate origin)**

Open https://shipping.starlinkailog.com → AuthGate appears → input email → click link in email → app loads.

In Supabase Dashboard → Authentication → Users, verify your row has `raw_app_meta_data` with `"role": "staff"`.

- [ ] **Step 4: Add a shipping record, verify created_by**

In shipping (admin mode), add a record. Then in Table Editor → records → verify the new row's `created_by` = your auth uid, RecordList row shows "创建:@yourprefix".

- [ ] **Step 5: Generate an invite for an external email**

In shipping (admin), open the new InvitePanel → input a personal email you control (not `@starlinkai-logistics.cn`) → click "生成邀请链接" → copy the URL.

- [ ] **Step 6: Open invite URL in incognito**

Paste invite URL into incognito window → DDP shows auth gate with blue "邀请链接" banner → input the same email → click link → check that email → click magic link in email → returns to DDP, no longer auth gate.

- [ ] **Step 7: Verify viewer restrictions**

In incognito DDP:
- Top of page shows orange "只读模式" banner
- "+ 新增柜子" button hidden
- Action buttons (编辑/删除) hidden
- Double-click on a row does nothing

- [ ] **Step 8: Verify viewer cannot access shipping**

In the same incognito session, navigate to https://shipping.starlinkailog.com → AuthGate shows "无访问权限" page.

- [ ] **Step 9: Verify invite is now consumed**

Back in your staff browser, refresh InvitePanel → invite shows status "已使用".

- [ ] **Step 10: Verify localStorage data migration prompt (optional, only if you had old DDP data)**

If a staff member previously used DDP and had localStorage data, the boot script doesn't currently migrate (we deleted that). If migration is needed, dispatch a follow-up task. For now: assume no migration; data lives in Supabase.

- [ ] **Step 11: Verify RLS by anonymous fetch**

In incognito console (no session):
```js
fetch('https://jqowxpcicqxbwubmowgr.supabase.co/rest/v1/shipments?select=*', {
  headers: {
    apikey: 'sb_publishable_HGioZE--7_zSapBl-JfuoQ_tiRknMvD',
    Authorization: 'Bearer sb_publishable_HGioZE--7_zSapBl-JfuoQ_tiRknMvD'
  }
}).then(r => r.json()).then(console.log)
```
Expected: empty array.

---

## Rollback

| Change | Rollback |
|--------|----------|
| 主页 HTML | Re-upload pre-change file to OSS, flush CDN |
| shipping React | `git revert` |
| DDP HTML | `git revert` and push |
| RLS on records | `drop policy "staff full access records"; create policy "anon all access" on records for all using (true) with check (true);` |
| Auth Hook | Auth → Hooks → unbind |
| invites table / shipments table | Keep tables (no harm), or `drop table` |
| roles in app_metadata | `update auth.users set raw_app_meta_data = raw_app_meta_data - 'role'` |
