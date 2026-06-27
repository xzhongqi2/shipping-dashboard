-- Fix Supabase Before User Created hook for invite-based external login.
-- Safe patch: replaces only the auth hook function. It does not delete users,
-- invites, shipments, records, or role data.
--
-- Supabase sends the signup email at event.user.email, not event.claims.email.

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
  email := lower(coalesce(event->'user'->>'email', ''));

  if email = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', '无法读取登录邮箱，请重新输入邮箱'
      )
    );
  end if;

  if email ~* '@starlinkai-logistics\.cn$' then
    return '{}'::jsonb;
  end if;

  select exists (
    select 1
    from public.invites
    where lower(invites.email) = email
      and used_at is null
      and expires_at > now()
  ) into has_invite;

  if has_invite then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', '此邮箱无访问权限。请确认使用收到邀请的邮箱，或联系管理员重新生成邀请链接'
    )
  );
end;
$$;

grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.before_user_created(jsonb) from authenticated, anon, public;
