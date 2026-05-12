# 🚀 海运拼箱 Dashboard — 部署指南

## 第一步：创建 Supabase 项目（5分钟）

1. 打开 https://supabase.com  → 点击 **"Start your project"**
2. 用 GitHub 账号登录（推荐，后续部署 Vercel 也用同一个账号）
3. 点击 **"New Project"**
4. 填写：
   - **Name**: `shipping-dashboard`
   - **Database Password**: 记下来（后面需要）
   - **Region**: 选 `Northeast Asia (Tokyo)` 或 `Singapore`（离中国近）
5. 点击 **"Create new project"**，等待 2 分钟

## 第二步：创建数据表（2分钟）

1. 左侧菜单点击 **SQL Editor**
2. 点击 **"New query"**
3. **复制粘贴**以下 SQL 并执行（`Run` 按钮）：

```sql
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

alter table public.records enable row level security;

create policy "用户读写自己记录"
  on public.records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_records_user_created
  on public.records (user_id, created_at desc);
```

✅ 执行成功后，左侧 **Database → Tables** 应能看到 `records` 表

## 第三步：获取 Supabase 密钥（1分钟）

1. 左侧菜单点击 **Settings → API**
2. 复制这两个值，**填到文件里**：

| 字段 | 位置 |
|------|------|
| `VITE_SUPABASE_URL` | **Project URL** 下方的值 |
| `VITE_SUPABASE_ANON_KEY` | **Project API keys → anon/public** 下方的值 |

3. 打开项目里的文件 `src/lib/supabase.js`，替换占位符：

```js
// 替换前
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL'
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'

// 替换后（示例）
const supabaseUrl = 'https://abcdefghijklm.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp...'
```

4. **同时** 在项目根目录创建 `.env` 文件（部署 Vercel 时需要）：
```
VITE_SUPABASE_URL=https://abcdefghijklm.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp...
```

## 第四步：推送到 GitHub（3分钟）

> 如果已经有 GitHub 仓库，跳过这步

1. 打开 https://github.com → 点击右上角 `+` → **New repository**
2. 填写：
   - **Repository name**: `shipping-dashboard`
   - 选择 **Public**（Vercel 免费版需要）
3. 点击 **"Create repository"**
4. 在您的电脑终端（项目目录下）运行：

```bash
cd /Users/vincentxing/WorkBuddy/2026-05-12-task-1
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/您的用户名/shipping-dashboard.git
git push -u origin main
```

## 第五步：部署到 Vercel（3分钟）

1. 打开 https://vercel.com → 用 GitHub 账号登录
2. 点击 **"Add New..." → Project**
3. 选择刚创建的 `shipping-dashboard` 仓库 → 点击 **Import**
4. 展开 **Environment Variables**，填入：
   - `VITE_SUPABASE_URL` = 您的 Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = 您的 Supabase Key
5. 点击 **Deploy** 🎉
6. 等待 1 分钟，获得免费域名，例如：`shipping-dashboard.vercel.app`

## 第六步：绑定公司域名（可选，5分钟）

1. 在 Vercel 项目页面 → **Settings → Domains**
2. 输入您的子域名，例如：`erp.您的公司.com`
3. Vercel 会给出 **DNS 配置说明**（通常是添加 A 记录或 CNAME 记录）
4. 去您的域名服务商（阿里云/腾讯云/GoDaddy 等）添加记录
5. 等待 DNS 生效（10分钟~24小时）

## ✅ 完成！

现在销售可以通过 `您的域名` 访问系统，注册账号后登录使用！

---

## 故障排除

| 问题 | 解决方法 |
|------|----------|
| 注册后没收到邮件 | Supabase → Settings → Auth → 关闭 **"Enable email confirm"**（测试阶段） |
| 登录后看不到数据 | 检查 Supabase → Table Editor → records 表是否有数据 |
| Vercel 部署失败 | 检查 Environment Variables 是否填写正确 |
| 域名无法访问 | 检查 DNS 解析是否生效（可用 `ping 您的域名` 测试） |
