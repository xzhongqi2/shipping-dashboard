# Unified Auth (Three Sites) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase email-magic-link auth to three sites (主页 / shipping / DDP) with `@starlinkai-logistics.cn` whitelist, and record `created_by` / `updated_by` / `updated_at` on every shipping record.

**Architecture:** Single shared Supabase project. Each site has its own Supabase client, its own login UI, and its own session in localStorage (per-origin). DDP's existing localStorage fake-auth is removed. shipping gets a top-level AuthGate. Records table gets audit fields filled by a SQL trigger.

**Tech Stack:** React 19 + Vite (shipping), static HTML + Supabase JS UMD bundle (主页 + DDP), Supabase Auth (Magic Link) + RLS + Auth Hooks.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `2026-05-12-task-1/supabase-schema-auth.sql` | DB migration: audit fields, trigger, RLS, Auth Hook function |
| Create | `2026-05-12-task-1/src/components/AuthGate.jsx` | shipping: gate the app behind Supabase session |
| Create | `2026-05-12-task-1/src/hooks/useAuthUser.js` | shipping: hook returning current Supabase user |
| Modify | `2026-05-12-task-1/src/lib/supabase.js` | (unchanged for now — single-origin only) |
| Modify | `2026-05-12-task-1/src/main.jsx` | Wrap App in AuthGate |
| Modify | `2026-05-12-task-1/src/hooks/useRecords.js` | Select related creator/updater email |
| Modify | `2026-05-12-task-1/src/App.jsx` | Header user badge + record-list creator/updater display |
| Modify | `20260314145618/index.html` | 主页: add login button + modal + Supabase JS |
| Modify | `ddp-tracking/index.html` | DDP: rip out localStorage auth, add Supabase auth gate |

---

## Task 1: Supabase configuration (manual, in Dashboard)

This is dashboard-only work the user does — no code change. Tasks 2+ depend on it.

- [ ] **Step 1: Configure redirect URLs**

In Supabase Dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: `https://starlinkailog.com`
- **Redirect URLs** (paste each on its own line):
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

Click **Save**.

- [ ] **Step 2: Enable Email provider**

Authentication → **Providers** → **Email**:

- ✅ **Enable Email Provider**
- ✅ **Confirm email** (required for Magic Link)
- ❌ Uncheck **Allow new users to sign up** is NOT what we want — leave this **on**. (Whitelist is enforced via Auth Hook below, not via signup toggle.)

Click **Save**.

- [ ] **Step 3: (Optional) Customize Magic Link email template**

Authentication → **Email Templates** → **Magic Link**:

- **Subject**: `登录星链智运`
- **Body**:
  ```html
  <h2>星链智运 · 登录</h2>
  <p>点击下方按钮登录星链智运后台:</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:10px 20px;background:#185FA5;color:white;text-decoration:none;border-radius:6px;">登录</a></p>
  <p style="color:#666;font-size:12px;margin-top:24px;">链接 1 小时内有效。如非本人操作请忽略。</p>
  ```

Save.

---

## Task 2: SQL migration — audit fields, trigger, RLS, Auth Hook

**Files:**
- Create: `2026-05-12-task-1/supabase-schema-auth.sql`

- [ ] **Step 1: Write the migration file**

Create `/Users/vincentxing/WorkBuddy/2026-05-12-task-1/supabase-schema-auth.sql`:

```sql
-- ════════════════════════════════════════════
-- 海运拼箱 / 三站统一认证 schema 变更
-- 在 Supabase → SQL Editor 中执行本脚本
-- ════════════════════════════════════════════

-- 1. records 加审计字段
alter table public.records
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- 2. 自动填充 trigger
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

-- 3. RLS: 只允许已登录用户读写
drop policy if exists "anon all access" on public.records;
drop policy if exists "authenticated all access" on public.records;
create policy "authenticated all access"
  on public.records for all
  to authenticated using (true) with check (true);

-- 4. 邮箱白名单 Auth Hook 函数
create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  email text;
begin
  email := lower(event->'claims'->>'email');
  if email !~* '@starlinkai-logistics\.cn$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '仅 @starlinkai-logistics.cn 公司邮箱可登录'
      )
    );
  end if;
  return event;
end;
$$;

grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
```

- [ ] **Step 2: Have the user run it in Supabase SQL Editor**

Supabase Dashboard → SQL Editor → New query → paste the file contents → Run.

Expected: "Success. No rows returned" or similar green confirmation.

- [ ] **Step 3: Bind the Auth Hook in dashboard**

Authentication → **Hooks** → **Before User Created Hook**:

- Hook type: **Postgres function**
- Schema: `public`
- Function: `before_user_created`
- ✅ Enable

Click **Create hook**.

- [ ] **Step 4: Verify by trying to sign up with non-whitelisted email**

In Supabase Dashboard → Authentication → Users → click **Add user** → enter `test@gmail.com` → submit.

Expected: error "仅 @starlinkai-logistics.cn 公司邮箱可登录".

If it succeeds, the hook isn't bound — go back to Step 3 and double-check.

- [ ] **Step 5: Commit the migration file**

```bash
cd /Users/vincentxing/WorkBuddy/2026-05-12-task-1
git add supabase-schema-auth.sql
git commit -m "feat(db): add audit fields, RLS for authenticated only, email whitelist hook"
```

---

## Task 3: shipping — useAuthUser hook

**Files:**
- Create: `2026-05-12-task-1/src/hooks/useAuthUser.js`

- [ ] **Step 1: Create the hook**

Create `/Users/vincentxing/WorkBuddy/2026-05-12-task-1/src/hooks/useAuthUser.js`:

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

  return { user, loading }
}
```

- [ ] **Step 2: Verify lint passes**

```bash
cd /Users/vincentxing/WorkBuddy/2026-05-12-task-1
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAuthUser.js
git commit -m "feat(shipping): add useAuthUser hook"
```

---

## Task 4: shipping — AuthGate component

**Files:**
- Create: `2026-05-12-task-1/src/components/AuthGate.jsx`

- [ ] **Step 1: Create the AuthGate component**

Create `/Users/vincentxing/WorkBuddy/2026-05-12-task-1/src/components/AuthGate.jsx`:

```jsx
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthUser } from '../hooks/useAuthUser'

const ALLOWED_DOMAIN = '@starlinkai-logistics.cn'

export function AuthGate({ children }) {
  const { user, loading } = useAuthUser()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">加载中...</div>
  }

  if (user) return children

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
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={`name${ALLOWED_DOMAIN}`}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3"
            required
          />
          {err && <p className="text-sm text-red-500 mb-3">{err}</p>}
          {msg && <p className="text-sm text-green-600 mb-3">{msg}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            {busy ? '发送中...' : '发送登录链接'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-5 text-center">
          仅 {ALLOWED_DOMAIN} 邮箱可登录
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AuthGate.jsx
git commit -m "feat(shipping): add AuthGate component with magic-link login"
```

---

## Task 5: shipping — wire AuthGate into main.jsx

**Files:**
- Modify: `2026-05-12-task-1/src/main.jsx`

- [ ] **Step 1: Read the current main.jsx**

Run: `cat /Users/vincentxing/WorkBuddy/2026-05-12-task-1/src/main.jsx`

It will look something like:
```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 2: Wrap App with AuthGate**

Edit the file so it looks exactly like:

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

Expected: `✓ built in ~100ms`, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.jsx
git commit -m "feat(shipping): gate app behind AuthGate"
```

---

## Task 6: shipping — header user badge + sign out

**Files:**
- Modify: `2026-05-12-task-1/src/App.jsx`

- [ ] **Step 1: Add useAuthUser import and component**

In `App.jsx`, after the existing `import { useAdmin } from './hooks/useAdmin'` line, add:

```jsx
import { useAuthUser } from './hooks/useAuthUser'
import { supabase } from './lib/supabase'
```

- [ ] **Step 2: Add a UserBadge component before the App function**

Find the section just before `export default function App()`. Add this component above it:

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

Find the header section in the App function (it has `<NextWeekButton>` and `<AdminButton>` inside a flex container). Modify the inner flex div to add `<UserBadge />` first:

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

- [ ] **Step 4: Build to verify**

```bash
npm run build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(shipping): show logged-in user prefix and sign-out in header"
```

---

## Task 7: shipping — display creator/updater on records

**Files:**
- Modify: `2026-05-12-task-1/src/hooks/useRecords.js`
- Modify: `2026-05-12-task-1/src/App.jsx`

- [ ] **Step 1: Update useRecords to fetch creator/updater email**

Edit `/Users/vincentxing/WorkBuddy/2026-05-12-task-1/src/hooks/useRecords.js`. Change the `tick` function's select call:

Find:
```js
      supabase
        .from('records')
        .select('*')
        .order('created_at', { ascending: false })
```

Replace with:
```js
      supabase
        .from('records')
        .select('*, creator:created_by(email), updater:updated_by(email)')
        .order('created_at', { ascending: false })
```

Also update the `add` and `update` calls similarly so they return the relations:

Find (in `add`):
```js
      .insert(newRecord)
      .select()
      .single()
```

Replace:
```js
      .insert(newRecord)
      .select('*, creator:created_by(email), updater:updated_by(email)')
      .single()
```

Find (in `update`):
```js
      .update(patch)
      .eq('id', id)
      .select()
      .single()
```

Replace:
```js
      .update(patch)
      .eq('id', id)
      .select('*, creator:created_by(email), updater:updated_by(email)')
      .single()
```

- [ ] **Step 2: Render creator/updater in RecordList**

In `App.jsx`, find the `RecordList` view-mode section (the `<div>` with `CBM:`, `KG:`, `收入:` info). Just below that grid, add a small line showing creator/updater.

Find:
```jsx
                <div className="grid grid-cols-3 gap-4 text-xs text-gray-500">
                  <span>CBM: {Number(r.cbm).toFixed(2)}</span>
                  <span>KG: {Number(r.kg).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  <span>收入: ¥{Number(r.revenue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
```

Replace with:
```jsx
                <div className="grid grid-cols-3 gap-4 text-xs text-gray-500">
                  <span>CBM: {Number(r.cbm).toFixed(2)}</span>
                  <span>KG: {Number(r.kg).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  <span>收入: ¥{Number(r.revenue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1.5">
                  创建:{r.creator?.email ? '@' + r.creator.email.split('@')[0] : '未知'}
                  {r.updater && r.updater.email && r.updater.email !== r.creator?.email && (
                    <> · 修改:@{r.updater.email.split('@')[0]}</>
                  )}
                </div>
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRecords.js src/App.jsx
git commit -m "feat(shipping): display creator/updater email prefix on each record"
```

---

## Task 8: 主页 — add Supabase JS, login modal, user menu

**Files:**
- Modify: `/Users/vincentxing/WorkBuddy/20260314145618/index.html`

- [ ] **Step 1: Add Supabase SDK script tag in `<head>`**

Open `/Users/vincentxing/WorkBuddy/20260314145618/index.html`.

Find the `</head>` line. Right before it, add:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

- [ ] **Step 2: Add login modal CSS in the existing `<style>` block**

Find the existing `.nav-dropdown` block in the `<style>` (added earlier for the Dashboard menu). After the last related rule, add:

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

- [ ] **Step 3: Replace the nav-CTA + lang-switch block with auth zone + lang-switch**

Find this block in `<nav id="navbar">`:

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

Replace with:

```html
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="nav-link" id="auth-login-btn" onclick="openAuthModal()" data-zh="登录" data-en="Sign In">登录</span>
      <div class="user-menu" id="auth-user-menu" style="display:none">
        <span class="user-menu-btn" onclick="toggleUserMenu(event)"><span id="auth-user-prefix"></span> ▾</span>
        <div class="user-menu-dropdown">
          <span class="user-menu-item" onclick="window.open('https://shipping.starlinkailog.com','_blank')">亚马逊拼柜</span>
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

- [ ] **Step 4: Add the login modal HTML at the end of `<body>`**

Find `</body>` near the end of the file. Right before it, add:

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

- [ ] **Step 5: Add the JS auth logic before the closing `</script>` (or before the existing main script tag)**

Find the **last** `<script>` block in the file (the one with `gp()`, `toggleLang()`, etc.). Right after the opening `<script>` line of that block, add:

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
  if (user) {
    loginBtn.style.display = 'none'
    userMenu.style.display = 'block'
    document.getElementById('auth-user-prefix').textContent = '@' + user.email.split('@')[0]
    closeAuthModal()
  } else {
    loginBtn.style.display = 'inline-block'
    userMenu.style.display = 'none'
  }
}
sb.auth.onAuthStateChange(() => refreshAuthUI())
refreshAuthUI()
```

- [ ] **Step 6: Open the file locally and verify**

```bash
open /Users/vincentxing/WorkBuddy/20260314145618/index.html
```

In the browser:
- 顶部右上应该出现"登录"按钮(在"立即咨询"左边)
- 点击后弹出登录 modal
- 输入 `random@gmail.com` → 显示红字"仅 @starlinkai-logistics.cn 邮箱可登录"
- 关闭 modal 还能正常浏览页面

(完整流程要部署到 OSS 才能测试 Supabase 邮件回调,本地只能测 UI 和前端校验。)

- [ ] **Step 7: Print upload reminder**

Tell the user:

> 主页改完。下一步上传 OSS:
> 1. 打开 https://oss.console.aliyun.com → starlinklog-web bucket → 文件管理
> 2. 点"上传文件" → 选 `/Users/vincentxing/WorkBuddy/20260314145618/index.html` → 勾"覆盖" → 上传
> 3. 阿里云 CDN 控制台 → 刷新预热 → URL 刷新:
>    - https://starlinkailog.com/
>    - https://starlinkailog.com/index.html

(主页是 OSS 静态资源,没有 git 仓库,改动靠手动上传。)

---

## Task 9: DDP — rip out localStorage auth, add Supabase auth gate

**Files:**
- Modify: `/Users/vincentxing/WorkBuddy/ddp-tracking/index.html`

This is the largest single-file change. We're deleting ~150 lines of fake-auth and adding ~80 lines of Supabase auth.

- [ ] **Step 1: Add Supabase SDK script tag**

Open `/Users/vincentxing/WorkBuddy/ddp-tracking/index.html`. Find `</head>` and add right before it:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

- [ ] **Step 2: Find and read the auth section to delete**

Run:
```bash
grep -n "AUTH_KEY\|USERS_KEY\|getUsers\|saveUsers\|getSession\|setSession\|clearSession\|simpleHash\|showLoginScreen\|showSetupPanel\|showLoginPanel\|login-overlay\|login-form\|login-screen" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

Note the line ranges for:
- The `<style>` rules for `.login-overlay`, `.login-box`, `.login-form`, `.login-input`, etc. (around lines 194–215)
- The `<div class="login-overlay" id="login-screen">...</div>` HTML block
- The JS section starting at `// ===== 认证系统 =====` (around line 525) and continuing through `showLoginPanel`

- [ ] **Step 3: Delete the login overlay HTML block**

Find the HTML block that opens with `<div class="login-overlay" id="login-screen">` and ends with the matching `</div>` for that overlay. Delete the entire block. (Use your editor's matching brace feature, or grep for the opening tag and find the next `</div><!-- /login -->` style closer; the file's structure makes this block easy to spot — it contains login-form, setup-panel, password inputs, etc.)

If unsure of the exact range, run:
```bash
grep -n "login-overlay\|login-screen\|setup-panel\|login-form" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html | head -20
```

Verify the bounds before deleting.

- [ ] **Step 4: Delete the login CSS block**

In the `<style>` block, find every rule starting with `.login-` (`.login-overlay`, `.login-box`, `.login-logo`, `.login-title`, `.login-sub`, `.login-form`, `.login-input-wrap`, `.login-input-icon`, `.login-input`, `.login-btn`, `.login-error`, `.login-link`) and delete those rules.

Use:
```bash
grep -n "^\.login-\|^.login-" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

to find each line; delete those rule blocks (each is a single line in this minified-ish CSS).

- [ ] **Step 5: Delete the auth JS section**

Find `// ===== 认证系统 =====` and delete everything from that comment down to the function `showLoginPanel`'s closing `}` (about 80–120 lines). Also remove any references to `AUTH_KEY`, `USERS_KEY`, `getUsers`, `saveUsers`, `getSession`, `setSession`, `clearSession`, `simpleHash` and the helper functions for the setup wizard.

The boundary: stop deleting **before** any function not related to auth (e.g., `loadData`, `apiCall`, `renderTable`).

After deletion, run:
```bash
grep -n "AUTH_KEY\|USERS_KEY\|getUsers\|simpleHash\|showLoginScreen\|showSetupPanel\|showLoginPanel" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

Expected: no matches.

- [ ] **Step 6: Add the new Supabase auth gate JS**

Right after the new Supabase SDK `<script>` tag in `<head>`, the SDK loads. The auth gate goes in the **main `<script>` block at the bottom of `<body>`**. Find that script block; at the very top of it (before any other code), add:

```js
// ===== Supabase Auth Gate =====
const SUPABASE_URL = 'https://jqowxpcicqxbwubmowgr.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_HGioZE--7_zSapBl-JfuoQ_tiRknMvD'
const ALLOWED_DOMAIN = '@starlinkai-logistics.cn'
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let _authUser = null

function showAuthGate() {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#F1F0EC;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;padding:20px;">
      <div style="background:white;border-radius:16px;padding:40px 36px;width:100%;max-width:380px;box-shadow:0 24px 80px rgba(0,0,0,.15);">
        <h1 style="font-size:20px;font-weight:700;color:#185FA5;margin:0 0 6px;">DDP 跟踪 · 登录</h1>
        <p style="font-size:13px;color:#666;margin:0 0 20px;">请使用公司邮箱登录</p>
        <div id="auth-msg" style="display:none;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:12px;"></div>
        <input id="auth-email" type="email" placeholder="name@starlinkai-logistics.cn"
          style="width:100%;padding:10px 12px;border:1.5px solid #D5D5D0;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px;" />
        <button id="auth-send" onclick="sendMagicLink()"
          style="width:100%;padding:11px;background:#185FA5;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
          发送登录链接
        </button>
        <p style="font-size:11px;color:#888;margin:12px 0 0;text-align:center;">仅 ${ALLOWED_DOMAIN} 邮箱可登录</p>
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

window.sendMagicLink = async function () {
  const email = document.getElementById('auth-email').value.trim()
  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
    showAuthMsg('仅 ' + ALLOWED_DOMAIN + ' 邮箱可登录', 'err')
    return
  }
  const btn = document.getElementById('auth-send')
  btn.disabled = true; btn.textContent = '发送中...'
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
  btn.disabled = false; btn.textContent = '发送登录链接'
  if (error) { showAuthMsg(error.message, 'err'); return }
  showAuthMsg('已发送登录链接到 ' + email, 'ok')
}

window.signOut = async function () {
  await sb.auth.signOut()
  location.reload()
}

;(async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) {
    showAuthGate()
    return
  }
  _authUser = session.user
  // Show signed-in indicator in app header (added below)
  setTimeout(() => {
    const header = document.querySelector('.app-header .header-actions')
    if (header && !document.getElementById('auth-user-badge')) {
      const span = document.createElement('span')
      span.id = 'auth-user-badge'
      span.style.cssText = 'color:white;font-size:12px;padding:4px 10px;border:1px solid rgba(255,255,255,.3);border-radius:6px;cursor:pointer;'
      span.textContent = '@' + _authUser.email.split('@')[0] + ' · 退出'
      span.onclick = () => window.signOut()
      header.appendChild(span)
    }
  }, 100)
})()
```

- [ ] **Step 7: Remove any remaining auth-related onclick handlers**

Search for `onclick="login()"`, `onclick="logout()"`, `onclick="goSetup()"`, `onclick="cancelSetup()"`, `onclick="saveSetup()"`:

```bash
grep -n "onclick=\"login\|logout\|goSetup\|cancelSetup\|saveSetup" /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

If matches remain, those are leftover from the deleted login overlay — remove them (likely just inside the deleted block already).

- [ ] **Step 8: Open locally to verify**

```bash
open /Users/vincentxing/WorkBuddy/ddp-tracking/index.html
```

Expected:
- Page shows the new login gate (centered card) instead of the original login overlay
- Type `gmail@gmail.com` → "仅 @starlinkai-logistics.cn 邮箱可登录"
- Closing/reload still shows the gate (no localStorage session)

If you see the original DDP table, it means there's leftover code keeping the old gate alive — verify the IIFE `checkAuth` ran and `showAuthGate` rendered.

- [ ] **Step 9: Commit and push**

```bash
cd /Users/vincentxing/WorkBuddy/ddp-tracking
git add index.html
git commit -m "feat: replace localStorage fake-auth with Supabase magic-link gate"
git push
```

Vercel will auto-deploy in ~1 minute.

---

## Task 10: End-to-end verification

This is manual, performed after Tasks 1–9 are all done and shipping/DDP are deployed.

- [ ] **Step 1: Test rejection of non-whitelisted email**

Open https://starlinkailog.com → 点"登录" → 输入 `test@gmail.com` → expect red error "仅 @starlinkai-logistics.cn 邮箱可登录" (前端先拦截).

If somehow it gets through to Supabase, the Auth Hook returns 403 — error message displays Supabase's message.

- [ ] **Step 2: Test successful login on 主页**

Input your real `@starlinkai-logistics.cn` email → click 发送登录链接 → check email → click magic link → returns to https://starlinkailog.com → top-right shows your `@prefix` badge.

- [ ] **Step 3: Test shipping login (separate origin)**

Open new tab https://shipping.starlinkailog.com → expect AuthGate (not main app) since session is on `starlinkailog.com` not `shipping.starlinkailog.com`. Input email → click send → check email → click link → returns to shipping → app loads with header showing your prefix.

- [ ] **Step 4: Add a record on shipping, verify DB has created_by**

In shipping, log in as admin (existing admin password), add a new record. Then in Supabase Dashboard → Table Editor → records → verify the new row's `created_by` is your auth uid.

- [ ] **Step 5: Edit the same record, verify updated_by + updated_at**

In shipping, edit that record. Refresh table → `updated_by` is your uid, `updated_at` is the new timestamp.

- [ ] **Step 6: Verify display in record list**

In shipping, the record's row should show "创建:@yourprefix" below the CBM/KG/Revenue line.

- [ ] **Step 7: Test DDP login**

Open https://ddp.starlinkailog.com → expect login gate → log in with company email → app loads.

- [ ] **Step 8: Test sign out**

On 主页, click `@prefix ▾` → 退出登录 → page refreshes, top-right shows "登录" again.

- [ ] **Step 9: Verify RLS by trying to read records as anon**

In a fresh incognito tab, open browser console at https://shipping.starlinkailog.com (you'll be on AuthGate). Run:
```js
fetch('https://jqowxpcicqxbwubmowgr.supabase.co/rest/v1/records?select=*', {
  headers: {
    'apikey': 'sb_publishable_HGioZE--7_zSapBl-JfuoQ_tiRknMvD',
    'Authorization': 'Bearer sb_publishable_HGioZE--7_zSapBl-JfuoQ_tiRknMvD'
  }
}).then(r => r.json()).then(console.log)
```

Expected: empty array `[]` (RLS denies anon).

---

## Deployment Sequence Reminder

To avoid breakage, deploy in this order:

1. Run `supabase-schema-auth.sql` in SQL Editor (Task 2)
2. Bind Auth Hook + redirect URLs in Supabase Dashboard (Task 1)
3. Push shipping code → Vercel auto-deploys (Tasks 3-7)
4. Push DDP code → Vercel auto-deploys (Task 9)
5. Upload 主页 `index.html` to OSS + flush CDN (Task 8)

Step 1 has to come first because shipping queries `records` with the new RLS policy — running the SQL switches it from "anon all access" to "authenticated only", and the new shipping code will already be sending auth tokens. Old shipping (deployed but pre-auth) would break the moment SQL runs since it has no auth token. So timing matters: ideally do SQL change and shipping deploy in quick succession, or accept ~1 minute of "shipping not loading data" while CDN catches up.

If users are actively using shipping right now, do this during a low-traffic window.
