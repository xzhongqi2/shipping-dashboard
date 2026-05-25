# 设计文档:三站统一认证(Supabase 邮箱魔法链接)+ 邀请码外部访客 + DDP 数据上云

**日期:** 2026-05-24(2026-05-25 扩展)
**作者:** Vincent Xing(口述需求)+ Claude(整理)
**状态:** 待实施

## 背景与动机

目前三个站点各自独立、认证方式不一致:

- 主页 `starlinkailog.com`(阿里云 OSS 静态 HTML):无登录
- shipping dashboard `shipping.starlinkailog.com`(React + Supabase):有匿名 client_id + 全局管理员密码,但没有真实用户身份
- DDP dashboard `ddp.starlinkailog.com`(Vercel 静态 HTML):有 localStorage 假登录,换浏览器就丢

业务诉求:**所有编辑要留痕**——能查到每条数据是谁、什么时候创建/修改的。当前匿名 + 单一管理员密码的模式做不到这一点。

## 需求

1. 三站共用同一套账号(在主页登一次,跳到 shipping/DDP 自动登录)
2. 用公司邮箱 `@starlinkai-logistics.cn` 作为身份(白名单,其他域名拒绝)
3. 免密码,采用 Supabase 邮箱魔法链接(Magic Link)
4. 业务表的所有写入操作记录 `created_by` / `updated_by` / `updated_at`
5. 拆掉 DDP 现有的 localStorage 假登录
6. 留痕信息能在 UI 上显示(列表里看到"创建人 / 修改人")

## 架构

```
                   ┌─────────────────────────────────┐
                   │       Supabase 项目(共用)       │
                   │  ┌───────────────────────────┐  │
                   │  │   auth.users(原生)         │  │
                   │  │   ↑ Auth Hook 校验邮箱后缀 │  │
                   │  └───────────────────────────┘  │
                   │  ┌───────────────────────────┐  │
                   │  │ records / shipments / ... │  │
                   │  │ + created_by / updated_by │  │
                   │  │ + RLS authenticated only  │  │
                   │  └───────────────────────────┘  │
                   └────────────────┬────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
       starlinkailog.com   shipping.starlinkai...  ddp.starlinkai...
       (静态 HTML)          (React)                 (静态 HTML)
       登录入口             AuthGate              AuthGate
              │                     │                     │
              └─── cookie domain: .starlinkailog.com ─────┘
                   (session 顶级域名共享)
```

### 关键不变量

- 业务数据访问由 Supabase RLS 把守:未登录读不到、写不进
- `created_by` / `updated_by` 由 trigger 自动写,前端无法绕过
- 邮箱白名单由后端 Auth Hook 强制(前端校验只是 UX,不是安全门)

## Supabase 配置变更

### 1. 启用 Email Auth(已默认启用)

Supabase Dashboard → Authentication → Providers → Email
- ✅ Enable Email Provider
- ✅ Enable Email Confirmations(对我们的魔法链接是必须的)
- 关闭"Allow new users to sign up"——不在这里限制,而是用 Auth Hook 控制(因为 Hook 能精确报错信息)

> 注:Supabase 的"Magic Link"和"Email + Password"共用一个 Email Provider 开关。我们前端只调 `signInWithOtp()`,实际就是 Magic Link 流程。

### 2. 重定向 URL 白名单

Authentication → URL Configuration → Redirect URLs:

```
https://starlinkailog.com
https://starlinkailog.com/*
https://shipping.starlinkailog.com
https://shipping.starlinkailog.com/*
https://ddp.starlinkailog.com
https://ddp.starlinkailog.com/*
```

**Site URL** 设为 `https://starlinkailog.com`(默认登录回跳点)。

### 3. 邮箱白名单 — Auth Hook(BeforeUserCreated)

Supabase 不允许在 `auth.users` 上直接挂 trigger(权限问题)。正确方式是用 **Supabase Auth Hooks**(Auth → Hooks → Before User Created):

1. Auth → Hooks → 启用 "Before User Created" hook
2. 选择类型 "Postgres function"
3. 创建函数:

```sql
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

grant execute on function public.before_user_created to supabase_auth_admin;
```

4. Auth → Hooks 中绑定上面这个函数

非白名单邮箱在 Supabase 创建用户时会被拦截,前端 `signInWithOtp` 收到 403 错误。

**前端兜底**:仍然在 `sendMagicLink` 里做一次 `endsWith` 校验,提前阻断、给用户友好提示——后端是真正的安全门,前端是 UX 门。

> 备选:如果 Supabase 项目所在版本不支持 Hooks(老项目),用 Edge Function 替代——Edge Function 接管 `signInWithOtp` 的入口校验。但 Hooks 是首选。

### 4. 邮件模板汉化(可选,推荐)

Authentication → Email Templates → Magic Link:

```
主题:登录星链智运
正文:
点击下方链接登录星链智运后台

[登录]({{ .ConfirmationURL }})

链接 1 小时内有效。如非本人操作请忽略。
```

## 数据库 schema 变更

### records 表加审计字段

```sql
-- 1. 加列
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
```

### RLS 改为只允许已登录用户

```sql
drop policy if exists "anon all access" on public.records;
drop policy if exists "authenticated all access" on public.records;

create policy "authenticated all access"
  on public.records for all
  to authenticated using (true) with check (true);
```

`app_state` / `cost_config` / `admin_config` 不动——前两个保持原状(app_state 公开读,cost_config 走 RPC),admin_config 维持 deny-all。

## 前端改动

## Session 共享(三站登录态如何同步)

**重要现实**:Supabase JS SDK v2 把 session 存在浏览器 localStorage,localStorage 是按 origin 严格隔离的(`shipping.starlinkailog.com` 和 `starlinkailog.com` 互不可见),且 SDK 没有"用 cookie 跨子域"的官方配置。**所以"主页登一次,自动同步到子站"在纯前端层面无法做到**(除非用 iframe + postMessage 这种复杂方案,YAGNI)。

实际策略:**让用户在哪个站点击登录,Magic Link 就回调哪个站**。

- 在主页点登录 → emailRedirectTo: 主页 → 登录态写入主页 localStorage
- 在 shipping 点登录 → emailRedirectTo: shipping → 登录态写入 shipping localStorage
- 在 DDP 点登录 → emailRedirectTo: DDP → 登录态写入 DDP localStorage

每个站独立 session,但因为是同一个 Supabase 项目,**同一个邮箱在哪登都是同一个 user_id**,留痕语义一致。

**用户体验**:第一次访问每个子站要点一次邮件链接(同一封都行,因为 Magic Link 邮件里的链接可重复使用 1 小时),之后浏览器记住 30 天。

要实现"主页登一次三站共享"必须把所有 dashboard 改成主页的子路径(同 origin),那是另一个量级的工程,本期不做。

### 子站的登录入口

shipping 和 DDP 的 AuthGate 在"未登录"状态下,显示**两种选项**:

```
需要登录

[ 用公司邮箱登录 ]   ← 直接在本站登录(发邮件,链接回调本站)
[ 前往主页 ]         ← 跳主页,如果之前在主页登过,主页能告诉用户已登录
```

主推第一个按钮,体验更直接。

### 主页 `starlinkailog.com`

**HTML 改动:**

1. 通过 CDN 引入 Supabase SDK:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

2. 导航栏右上角加一个登录态组件(`#auth-zone`):
```html
<div id="auth-zone">
  <span id="auth-login-btn" class="nav-link" onclick="openLoginModal()">登录</span>
  <div id="auth-user-menu" style="display:none">
    <span class="user-prefix"></span>
    <span onclick="signOut()">退出</span>
  </div>
</div>
```

3. 登录 modal:
```html
<div id="login-modal" class="modal-overlay">
  <div class="modal">
    <h3>星链智运 · 内部登录</h3>
    <input type="email" id="login-email" placeholder="kyle@starlinkai-logistics.cn" />
    <button onclick="sendMagicLink()">发送登录链接</button>
    <p class="hint">仅 @starlinkai-logistics.cn 邮箱可登录</p>
  </div>
</div>
```

4. `<script>` 里:
```js
async function sendMagicLink() {
  const email = document.getElementById('login-email').value.trim()
  if (!email.endsWith('@starlinkai-logistics.cn')) {
    showError('仅公司邮箱可登录')
    return
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: 'https://starlinkailog.com' }
  })
  if (error) { showError(error.message); return }
  showSuccess('已发送登录链接到 ' + email + ',请到邮箱点击链接完成登录')
}

async function signOut() {
  await supabase.auth.signOut()
  refreshAuthUI()
}

async function refreshAuthUI() {
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    document.getElementById('auth-login-btn').style.display = 'none'
    document.getElementById('auth-user-menu').style.display = 'flex'
    document.querySelector('.user-prefix').textContent = user.email.split('@')[0]
  } else {
    document.getElementById('auth-login-btn').style.display = 'block'
    document.getElementById('auth-user-menu').style.display = 'none'
  }
}

supabase.auth.onAuthStateChange(() => refreshAuthUI())
refreshAuthUI()
```

### shipping(React)

1. `src/lib/supabase.js` 加 cookie domain 配置(同上)

2. 新建 `src/components/AuthGate.jsx`:
```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function AuthGate({ children }) {
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

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>
  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">需要登录</h1>
      <p className="text-sm text-gray-600 mb-6">请使用公司邮箱在主页登录后访问</p>
      <a href="https://starlinkailog.com" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg">前往主页登录</a>
    </div>
  )
  return children
}
```

3. `src/main.jsx` 用 AuthGate 包裹 App:
```jsx
<AuthGate><App /></AuthGate>
```

4. 在 header 显示当前用户邮箱前缀和退出按钮(放在 AdminButton 旁边)

5. `RecordList` 行末显示 `created_by` / `updated_by` 对应邮箱前缀。需要在前端 join 一个简单的"uid → email" 映射:在 `useRecords` 里 select 时多带一个字段(走 supabase 的关联查询):
```js
.select('*, creator:created_by(email), updater:updated_by(email)')
```
显示成 `创建:@kyle · 修改:@bob`,如果 NULL 则显示"未知"。

> 这种 join 在 Supabase 需要 records 与 auth.users 的外键关系——上面 SQL 已经定义。

### DDP(`/Users/vincentxing/WorkBuddy/ddp-tracking/index.html`)

**删掉的代码段(全部清空)**:
- `AUTH_KEY` / `USERS_KEY` 常量
- `getUsers` / `saveUsers` / `getSession` / `setSession` / `clearSession` / `simpleHash`
- `showLoginScreen` / `showSetupPanel` / `showLoginPanel`
- 整个 `#login-overlay` HTML 结构
- 所有相关 CSS(`.login-overlay` / `.login-box` / `.login-form` 等)

**新加**:
- 引入 Supabase SDK(同主页 CDN)
- 用相同的 supabase client 配置
- 页面打开先 `getSession`,没登录显示"请到主页登录"页面 + 跳转按钮(同 shipping AuthGate 思路)

DDP 当前数据存 localStorage,**这次不接 Supabase 数据存储**——这是后续独立改动。本次仅接认证。

## 主页部署细节

主页是阿里云 OSS 静态文件,改完后:
1. 上传新 `index.html` 覆盖 OSS
2. CDN 控制台刷新 `https://starlinkailog.com/` 和 `https://starlinkailog.com/index.html`

## 错误处理

| 场景 | 处理 |
|------|------|
| 输入非白名单邮箱 | 前端先校验,弹红字"仅公司邮箱可登录",不发请求 |
| 后端校验失败(理论上不可达,前端校验已过) | 显示 Supabase 返回的原始 error message |
| 邮件链接过期 | Supabase 自动跳错误页,提示重新发送 |
| 网络失败 | catch 后弹"网络错误,请重试" |
| 登录后跳子站 cookie 没生效 | 子站 fallback 显示登录提示页(AuthGate 已覆盖此情况) |

## 测试与验证

无测试框架,手动走查:

- [ ] Supabase 后台白名单邮箱列表正确
- [ ] 输入 `random@gmail.com` → 前端拒绝
- [ ] 输入 `kyle@starlinkai-logistics.cn` → 收到邮件
- [ ] 点邮件链接 → 跳回主页,显示用户邮箱前缀
- [ ] 跳 shipping → 自动登录,header 显示用户名
- [ ] 跳 DDP → 自动登录,显示原 dashboard
- [ ] 主页退出 → 刷新 shipping 也变成未登录
- [ ] 用 anon SQL client 直接读 records → 拿不到数据
- [ ] 登录后新建一条 record → DB 里 `created_by` 是当前用户 uuid
- [ ] 编辑一条记录 → `updated_by` 变成当前用户,`updated_at` 更新
- [ ] shipping `RecordList` 行末显示创建人 / 修改人 邮箱前缀

## 回滚

| 改动 | 回滚方式 |
|------|---------|
| 主页代码 | 重新上传旧 `index.html` 到 OSS,刷 CDN |
| shipping 代码 | `git revert` |
| DDP 代码 | `git revert` |
| RLS 策略 | 重跑旧 policy:`create policy "anon all access" on records for all using (true) with check (true);` |
| Auth Hook | Auth → Hooks 解绑函数即可,函数本身可保留(保留 SQL 函数无害);彻底清理:`drop function public.before_user_created` |
| 数据库审计字段 | 字段保留即可(增量,不影响旧逻辑);彻底清理:`alter table records drop column created_by, drop column updated_by, drop column updated_at` |

## 不做(YAGNI)

- 用户分组 / 角色管理(超出留痕需求)
- 完整审计日志表(方案 B,日后再升级)
- 软删除回收站(方案 C)
- 密码登录(磁链接已够用)
- 忘记密码 / 改密码流程(没密码)
- 用户头像上传
- shipping `client_id` 移除(保留兜底,不冲突)

## 已确认决策记录

| 议题 | 决定 |
|------|------|
| 范围 | 三站共用一套账号 |
| 注册方式 | Supabase 邮箱魔法链接(免密码) |
| 邮箱白名单 | `@starlinkai-logistics.cn`(staff 角色)+ 邀请码邮箱(viewer 角色) |
| 留痕深度 | 方案 A(`created_by` / `updated_by` / `updated_at`) |
| 历史数据 | 不回填 `created_by`,保持 NULL,UI 显示"未知" |
| 三站 session 共享 | 各自 origin 独立 session |
| DDP 数据存储 | **本次同时迁移到 Supabase**(随邀请码功能一起做) |
| 现有匿名 client_id | 保留,与 created_by 共存 |
| 现有 useAdmin 管理员密码 | 保留,与 Supabase Auth 正交 |
| 邀请码方式 | URL 邀请链接 + 限定邮箱,一次性,30 天有效 |
| viewer 可见范围 | 全部 DDP 数据(`shipments` 表 SELECT) |
| viewer 不可见 | shipping 的 records 表(RLS 拦) |

---

## 扩展 §A — 邀请码与 viewer 角色

### 角色模型

`auth.users.raw_app_meta_data.role` 字段:

| 值 | 来源 | 权限 |
|----|------|------|
| `staff` | `@starlinkai-logistics.cn` 邮箱登录 | shipping + DDP 全部读写 |
| `viewer` | 邀请码登录 | 仅 DDP `shipments` 表 SELECT |

`app_metadata` 由 Supabase Admin API 写入,客户端无法篡改 → 这是权限的安全来源。

### invites 表

```sql
create table public.invites (
  code        text primary key,
  email       text not null,                              -- 限定哪个邮箱可以用
  role        text not null default 'viewer'
              check (role in ('viewer')),
  scope       text not null default 'ddp',                -- 当前只 'ddp',预留扩展
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days'),
  used_at     timestamptz,
  used_by     uuid references auth.users(id)
);

alter table public.invites enable row level security;

-- 只有 staff 能看/建邀请码
create policy "staff manage invites" on public.invites
  for all to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'staff')
  with check (auth.jwt()->'app_metadata'->>'role' = 'staff');
```

### 流程

**staff 发邀请**:

shipping 加一个"邀请管理"入口(管理员模式下可见,跟 CostConfigPanel 同一类):

1. 输入对方邮箱 → 调 RPC `create_invite(target_email)` → 返回邀请码
2. 页面拼好链接 `https://ddp.starlinkailog.com/?invite=<code>` → 一键复制按钮
3. 列表展示已发出的邀请,显示状态(未使用 / 已使用 / 已过期)、复制链接、撤销

```sql
-- RPC: 生成邀请码(staff 限定)
create or replace function public.create_invite(target_email text)
returns table (code text, expires_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
declare
  new_code text;
  uid uuid;
begin
  uid := auth.uid();
  if (auth.jwt()->'app_metadata'->>'role') is distinct from 'staff' then
    raise exception 'only staff can create invites';
  end if;

  -- 生成简短不可猜的 code(8 位 base32-like)
  new_code := encode(gen_random_bytes(6), 'base64');
  new_code := replace(replace(replace(new_code, '+', ''), '/', ''), '=', '');

  insert into public.invites (code, email, created_by)
    values (new_code, lower(target_email), uid);

  return query select new_code, (now() + interval '30 days')::timestamptz;
end;
$$;

grant execute on function public.create_invite(text) to authenticated;
```

**外部人接受邀请**:

DDP `index.html` 启动时检测 URL 的 `?invite=xxx` 参数:

1. 跳转到一个内嵌的"邀请页"(替换 AuthGate):
   ```
   星链智运邀请你查看 DDP 物流跟踪
   请输入邀请对应的邮箱:[输入框]
   [发送登录链接]
   ```
2. 提交后 DDP 调 RPC `validate_invite(code, email)` 校验:code 存在、未使用、未过期、email 匹配
3. 校验通过 → 调 `signInWithOtp({ email })` 走 magic link
4. 用户点邮件链接登录 → DDP 在 `onAuthStateChange` 中检测到 `?invite=xxx` 仍在 URL → 调 RPC `consume_invite(code)`:校验通过后把 invite 标记 used,把当前用户 `app_metadata.role` 设为 `'viewer'`

```sql
-- RPC: 校验邀请码(签发 magic link 之前)
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

-- RPC: 消费邀请码 + 提升当前用户为 viewer(登录回调后调用)
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

  -- 标记 invite 已用
  update public.invites
    set used_at = now(), used_by = uid
    where code = p_code;

  -- 设置当前用户 role = viewer
  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                            || jsonb_build_object('role', 'viewer')
    where id = uid;

  return true;
end;
$$;

grant execute on function public.consume_invite(text) to authenticated;
```

### Auth Hook 改进

之前白名单仅放行 `@starlinkai-logistics.cn`。现在要放行**两类人**:

- 邮箱在白名单 → 同时把 `role = 'staff'` 写入 `app_metadata`
- 邮箱不在白名单 → 检查是否有未过期未使用的邀请码与该邮箱匹配 → 通过则放行(role 在 `consume_invite` 时设)

```sql
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

  -- 公司邮箱:直接放行,标记 staff
  if email ~* '@starlinkai-logistics\.cn$' then
    return jsonb_set(
      event,
      '{claims,app_metadata,role}',
      to_jsonb('staff'::text)
    );
  end if;

  -- 邀请码邮箱:有未消费且未过期的邀请才放行
  select exists (
    select 1 from public.invites
    where lower(invites.email) = email
      and used_at is null
      and expires_at > now()
  ) into has_invite;

  if has_invite then
    return event;  -- 放行,role 由 consume_invite 在登录后设置
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

### viewer UI 限制

DDP 启动检测当前用户 role(从 `session.user.app_metadata.role`):

- `staff`:正常 UI
- `viewer`:
  - 顶部加红色提示条"只读模式 — 您是受邀访客"
  - 隐藏:`新增柜子` 按钮、所有行的 `编辑` `删除` 按钮、节点编辑入口、双击编辑事件
  - 任何写入 RPC 调用都会被 RLS 拦截(双重保险)

shipping `AuthGate` 检测 role:

- `staff`:进入 dashboard
- 其他(`viewer` / 无 role):显示"无权限,此页面仅限内部员工"

主页 `auth-user-menu` 中,viewer 看到的 dashboard 链接只有 DDP,亚马逊拼柜入口隐藏。

---

## 扩展 §B — DDP 数据上云(shipments 表)

### 表结构

```sql
create table public.shipments (
  id            uuid primary key default gen_random_uuid(),
  -- 顶层常用字段(便于过滤排序)
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
  -- 其他字段(seal、地址、工厂联系等)和 16 个节点状态用 JSONB
  details       jsonb not null default '{}'::jsonb,
  nodes         jsonb not null default '{}'::jsonb,
  -- 审计
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_shipments_created on public.shipments(created_at desc);
create index idx_shipments_container on public.shipments(container);

-- 复用 set_audit_fields trigger
drop trigger if exists trg_shipments_audit on public.shipments;
create trigger trg_shipments_audit
  before insert or update on public.shipments
  for each row execute function public.set_audit_fields();

alter table public.shipments enable row level security;

-- staff 全权
create policy "staff full access shipments" on public.shipments
  for all to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'staff')
  with check (auth.jwt()->'app_metadata'->>'role' = 'staff');

-- viewer 只读
create policy "viewer read shipments" on public.shipments
  for select to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'viewer');
```

### 为什么用 JSONB 存 details / nodes

DDP 原数据有 20+ 字段(`shipperAddr`, `consigneeAddr`, `factoryName`, `factoryContact`, ...),`nodes` 是 16 个节点 × 3 字段(`status` / `date` / `note`)= 48 个字段。全拆成列要 alter table 30+ 次;以后改字段又要迁移。JSONB 让前端继续用现有数据形状(`shipmentData` 对象),序列化即写,反序列化即读,改字段无需 schema 变更。

代价:不能直接用 SQL 索引节点状态做查询。但 DDP 列表过滤目前都在前端做,不影响。

### DDP 代码改造

替换数据层。原来的:

```js
// 旧
let shipmentData = []
shipmentData = JSON.parse(localStorage.getItem('ddp_tracking_data')) || sampleData
```

新的:

```js
// 新
let shipmentData = []
async function loadShipments() {
  const { data, error } = await sb
    .from('shipments')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error(error); return }
  // 把 DB 行转回前端期望的扁平结构
  shipmentData = data.map(row => ({
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
  }))
}
```

写入对应:

```js
async function saveShipment(record, action) {
  const payload = {
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
  if (action === 'add') {
    const { data, error } = await sb.from('shipments').insert(payload).select().single()
    if (error) throw error
    return data.id
  } else if (action === 'update') {
    const { error } = await sb.from('shipments').update(payload).eq('id', record.id)
    if (error) throw error
  } else if (action === 'delete') {
    const { error } = await sb.from('shipments').delete().eq('id', record.id)
    if (error) throw error
  }
}
```

把原 HTML 里 `apiCall` 整段、`saveDataToApi` 里的自定义 REST 路径、`loadData` 中的 localStorage 兜底全部替换成上面的 Supabase 调用。

### 示例数据迁移(种子)

`sampleData` 那 5 条示例数据从 `index.html` 移到独立 SQL `supabase-seed-shipments.sql`,你跑一次 INSERT 即可作为初始演示数据。代码里 `sampleData` 常量删掉。

```sql
-- supabase-seed-shipments.sql:首次部署时一次性运行
insert into public.shipments (booking, container, shipper, consignee, origin_port, dest_port, goods, ctns, volume, weight, dept, details, nodes)
values
  ('SZ-YT-20250508-001', 'MSCU8765432', '深圳市星链智运科技有限公司', 'ABC IMPORT CORP', '深圳盐田', '洛杉矶', '电子配件 / Electronic Components', 240, 14.5, 4200, '操作部',
   '{"seal":"SL20250501","shipperAddr":"深圳市南山区科技园","consigneeAddr":"123 Commerce St, Los Angeles, CA 90001","factoryName":"深圳市金鑫电子厂","factoryAddr":"深圳市龙华区大浪街道金鑫工业园A栋","factoryContact":"李经理 138-0755-0001","tempContainer":"TMP-YT-2025-0501","destCity":"Los Angeles, CA","destAddr":"456 Logistics Blvd, LA, CA"}'::jsonb,
   '{"booking":{"status":"done","date":"2025-05-08","note":"已确认舱位"},"truck_pickup":{"status":"done","date":"2025-05-10","note":""},"stuffing":{"status":"done","date":"2025-05-10","note":"装柜完成"},"cy_entry":{"status":"done","date":"2025-05-11","note":""},"exp_customs":{"status":"done","date":"2025-05-11","note":""},"exp_clearance":{"status":"done","date":"2025-05-11","note":"放行"},"sailing":{"status":"done","date":"2025-05-12","note":""},"eta":{"status":"progress","date":"","note":"ETA: 2025-05-28"},"ocean_track":{"status":"progress","date":"","note":"航行中"},"arrival":{"status":"pending","date":"","note":""},"arrival_date":{"status":"pending","date":"","note":""},"imp_customs":{"status":"pending","date":"","note":""},"imp_clearance":{"status":"pending","date":"","note":""},"dray":{"status":"pending","date":"","note":""},"delivery":{"status":"pending","date":"","note":""},"pod":{"status":"pending","date":"","note":""}}'::jsonb);
-- (其余 4 条同构,实施时补齐)
```

### localStorage 旧数据迁移

DDP 第一次以 staff 身份登录后,前端 IIFE 检测:

```js
const oldData = localStorage.getItem('ddp_tracking_data')
if (oldData && _authUser.app_metadata?.role === 'staff') {
  if (confirm('检测到本地 DDP 数据,是否上传到云端?')) {
    const arr = JSON.parse(oldData)
    for (const r of arr) {
      delete r.id  // 让 DB 重新生成 uuid
      await saveShipment(r, 'add')
    }
    localStorage.removeItem('ddp_tracking_data')
    location.reload()
  }
}
```

只迁一次,迁完清掉本地。

### 性能与体验

- 首次加载从 Supabase 拉一次,以后增删改在前端立即更新本地数组 + 调 Supabase 持久化。30 秒轮询一次拉远端最新(类似 shipping 的 useRecords)
- viewer 看到的就是同一份数据
- 所有行底部多一行 `创建:@xxx · 修改:@yyy`,跟 shipping 一致
