-- Permission Center migration.
-- Run in Supabase SQL Editor after confirming at least one user has role = owner.

-- 1) Allow invitation rows to carry the role that will be assigned after invite consumption.
alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites
  add constraint invites_role_check
  check (role in ('staff', 'operator', 'viewer'));

-- 2) Owner-only invite table management.
drop policy if exists "staff manage invites" on public.invites;
drop policy if exists "owner manage invites" on public.invites;
create policy "owner manage invites" on public.invites
  for all
  to authenticated
  using (auth.jwt()->'app_metadata'->>'role' = 'owner')
  with check (auth.jwt()->'app_metadata'->>'role' = 'owner');

-- 3) Owner-only user list for the permission center.
create or replace function public.list_user_roles()
returns table (
  id uuid,
  email text,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    u.email::text,
    coalesce(u.raw_app_meta_data->>'role', 'viewer') as role,
    u.created_at,
    u.last_sign_in_at
  from auth.users u
  where auth.jwt()->'app_metadata'->>'role' = 'owner'
  order by u.created_at desc;
$$;

grant execute on function public.list_user_roles() to authenticated;

-- 4) Owner-only role assignment. Users must already exist in auth.users.
create or replace function public.set_user_role(target_email text, target_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_email text;
  normalized_email text;
begin
  caller_role := auth.jwt()->'app_metadata'->>'role';
  caller_email := lower(auth.jwt()->>'email');
  normalized_email := lower(trim(target_email));

  if caller_role is distinct from 'owner' then
    raise exception 'only owner can set user roles';
  end if;

  if target_role not in ('owner', 'staff', 'operator', 'viewer') then
    raise exception 'invalid role: %', target_role;
  end if;

  if normalized_email = caller_email and target_role <> 'owner' then
    raise exception 'owner cannot remove own owner role';
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', target_role)
  where lower(email) = normalized_email;

  if not found then
    raise exception 'user not found: %', normalized_email;
  end if;
end;
$$;

grant execute on function public.set_user_role(text, text) to authenticated;

-- 5) Owner-only invitation creation. Existing frontend calls with target_email still work.
drop function if exists public.create_invite(text);
drop function if exists public.create_invite(text, text);

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

-- 6) Invitation consumption assigns the role stored on the invite.
drop function if exists public.consume_invite(text);

create or replace function public.consume_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites;
  current_email text;
begin
  current_email := lower(auth.jwt()->>'email');

  select * into inv
  from public.invites
  where code = p_code
    and used_at is null
    and expires_at > now();

  if not found then
    raise exception 'invite not found or expired';
  end if;

  if lower(inv.email) <> current_email then
    raise exception 'invite email mismatch';
  end if;

  update public.invites
  set used_at = now()
  where code = p_code;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', inv.role)
  where id = auth.uid();
end;
$$;

grant execute on function public.consume_invite(text) to authenticated;

-- 7) Shipping dashboard records: owner/staff/operator can write, viewer can read.
drop policy if exists "anon all access" on public.records;
drop policy if exists "authenticated all access" on public.records;
drop policy if exists "staff full access records" on public.records;
drop policy if exists "staff and owner full access records" on public.records;
drop policy if exists "owner staff operator write records" on public.records;
drop policy if exists "viewer read records" on public.records;

create policy "owner staff operator write records"
on public.records
for all
to authenticated
using ((auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator'))
with check ((auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator'));

create policy "viewer read records"
on public.records
for select
to authenticated
using ((auth.jwt()->'app_metadata'->>'role') = 'viewer');

-- 8) DDP shipments: owner/staff/operator can write, viewer can read.
drop policy if exists "staff full access shipments" on public.shipments;
drop policy if exists "staff and owner full access shipments" on public.shipments;
drop policy if exists "owner staff operator write shipments" on public.shipments;
drop policy if exists "viewer read shipments" on public.shipments;

create policy "owner staff operator write shipments"
on public.shipments
for all
to authenticated
using ((auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator'))
with check ((auth.jwt()->'app_metadata'->>'role') in ('owner', 'staff', 'operator'));

create policy "viewer read shipments"
on public.shipments
for select
to authenticated
using ((auth.jwt()->'app_metadata'->>'role') = 'viewer');
