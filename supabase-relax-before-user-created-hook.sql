-- Relax Supabase Before User Created hook so magic-link emails can be sent.
-- Safe patch: it only changes the signup hook. It does not delete or modify
-- users, invites, shipments, records, or role data.
--
-- Access is still protected after login:
-- - DDP consumes the invite code with public.consume_invite(p_code).
-- - consume_invite checks the invite is unused, unexpired, and email-matched.
-- - RLS only allows viewer/staff/operator/owner roles to read/write data.

create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return '{}'::jsonb;
end;
$$;

grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.before_user_created(jsonb) from authenticated, anon, public;
