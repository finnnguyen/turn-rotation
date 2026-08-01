create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
create schema if not exists private;
create schema if not exists audit;

revoke all on schema private from public, anon, authenticated;
revoke all on schema audit from public, anon, authenticated;
grant usage on schema app to authenticated;
grant usage on schema private to authenticated;

create type app.app_role as enum ('manager', 'staff');
create type app.qualification_level as enum (
  'primary',
  'general',
  'busy_only',
  'cannot_perform'
);
create type app.turn_calculation_type as enum (
  'dollar',
  'mens_haircut',
  'womens_haircut',
  'excluded'
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;
grant execute on function private.set_updated_at() to authenticated;

comment on schema app is 'Turn Rotation business data exposed through the Supabase API with RLS.';
comment on schema private is 'Privileged helper functions that are never exposed to browser clients.';
comment on schema audit is 'Append-only audit data introduced in a later milestone.';
