create table app.salon_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  timezone text not null default 'America/Los_Angeles',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  role app.app_role not null default 'staff',
  primary_location_id uuid references app.salon_locations(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.employees (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  user_id uuid unique references app.user_profiles(id) on delete set null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  active boolean not null default true,
  accepting_walk_ins_by_default boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, location_id)
);

create unique index employees_active_name_per_location
  on app.employees (location_id, lower(display_name))
  where active;

create table app.employee_location_memberships (
  user_id uuid not null references app.user_profiles(id) on delete cascade,
  location_id uuid not null references app.salon_locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

create trigger salon_locations_set_updated_at
before update on app.salon_locations
for each row execute function private.set_updated_at();

create trigger user_profiles_set_updated_at
before update on app.user_profiles
for each row execute function private.set_updated_at();

create trigger employees_set_updated_at
before update on app.employees
for each row execute function private.set_updated_at();

create or replace function private.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.user_profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'Staff'), '@', 1)
    )
  );
  return new;
end;
$$;

revoke all on function private.create_user_profile() from public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.create_user_profile();

create or replace function private.current_user_role()
returns app.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from app.user_profiles
  where id = (select auth.uid())
    and active;
$$;

create or replace function private.user_has_location(target_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.employee_location_memberships
    where user_id = (select auth.uid())
      and location_id = target_location_id
  );
$$;

create or replace function private.is_manager_at(target_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.current_user_role() = 'manager'
    and private.user_has_location(target_location_id);
$$;

revoke all on function private.current_user_role() from public;
revoke all on function private.user_has_location(uuid) from public;
revoke all on function private.is_manager_at(uuid) from public;

grant execute on function private.current_user_role() to authenticated;
grant execute on function private.user_has_location(uuid) to authenticated;
grant execute on function private.is_manager_at(uuid) to authenticated;

alter table app.salon_locations enable row level security;
alter table app.user_profiles enable row level security;
alter table app.employees enable row level security;
alter table app.employee_location_memberships enable row level security;

create policy locations_select_for_members
on app.salon_locations for select
to authenticated
using (private.user_has_location(id));

create policy profiles_select_self_or_location_manager
on app.user_profiles for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from app.employee_location_memberships membership
    where membership.user_id = user_profiles.id
      and private.is_manager_at(membership.location_id)
  )
);

create policy profiles_update_self
on app.user_profiles for update
to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and role = private.current_user_role()
);

create policy employees_select_for_members
on app.employees for select
to authenticated
using (private.user_has_location(location_id));

create policy employees_insert_for_managers
on app.employees for insert
to authenticated
with check (private.is_manager_at(location_id));

create policy employees_update_for_managers
on app.employees for update
to authenticated
using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));

create policy memberships_select_self_or_manager
on app.employee_location_memberships for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_manager_at(location_id)
);

create policy memberships_manage_for_managers
on app.employee_location_memberships for all
to authenticated
using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));

grant select on app.salon_locations, app.user_profiles, app.employees,
  app.employee_location_memberships to authenticated;
grant insert, update on app.employees to authenticated;
grant insert, update, delete on app.employee_location_memberships to authenticated;
