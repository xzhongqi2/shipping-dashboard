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
