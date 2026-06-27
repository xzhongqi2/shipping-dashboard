-- Fix invite code generation for databases where gen_random_bytes() is unavailable.
-- Safe patch: replaces only the create_invite RPC body. Existing users, roles,
-- records, and invite rows are not deleted or modified.

create or replace function public.create_invite(target_email text, target_role text default 'viewer')
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  exp timestamptz;
  uid uuid;
begin
  uid := auth.uid();

  if (auth.jwt()->'app_metadata'->>'role') is distinct from 'owner' then
    raise exception 'only owner can create invites';
  end if;

  if target_role not in ('staff', 'operator', 'viewer') then
    raise exception 'invalid invite role: %', target_role;
  end if;

  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  exp := now() + interval '30 days';

  insert into public.invites (code, email, role, created_by, expires_at)
    values (new_code, lower(trim(target_email)), target_role, uid, exp);

  return query select new_code, exp;
end;
$$;

grant execute on function public.create_invite(text, text) to authenticated;
