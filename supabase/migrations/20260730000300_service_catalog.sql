create table app.service_categories (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  name text not null check (char_length(trim(name)) between 1 and 100),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, name),
  unique (id, location_id)
);

create table app.services (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  category_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  turn_calculation app.turn_calculation_type not null default 'dollar',
  typical_duration_minutes integer check (typical_duration_minutes between 1 and 720),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, name),
  unique (id, location_id),
  foreign key (category_id, location_id)
    references app.service_categories(id, location_id)
);

create table app.service_price_versions (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null,
  location_id uuid not null references app.salon_locations(id),
  listed_price numeric(10, 2) not null check (listed_price >= 0),
  effective_from timestamptz not null,
  effective_until timestamptz,
  changed_by uuid references app.user_profiles(id),
  change_reason text not null check (char_length(trim(change_reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from),
  foreign key (service_id, location_id)
    references app.services(id, location_id),
  exclude using gist (
    service_id with =,
    tstzrange(effective_from, effective_until, '[)') with &&
  )
);

create index service_categories_location_active
  on app.service_categories (location_id, active, sort_order);
create index services_location_category_active
  on app.services (location_id, category_id, active);
create index service_price_versions_current
  on app.service_price_versions (service_id, effective_from desc);

create trigger service_categories_set_updated_at
before update on app.service_categories
for each row execute function private.set_updated_at();

create trigger services_set_updated_at
before update on app.services
for each row execute function private.set_updated_at();

alter table app.service_categories enable row level security;
alter table app.services enable row level security;
alter table app.service_price_versions enable row level security;

create policy categories_select_for_members
on app.service_categories for select to authenticated
using (private.user_has_location(location_id));

create policy categories_manage_for_managers
on app.service_categories for all to authenticated
using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));

create policy services_select_for_members
on app.services for select to authenticated
using (private.user_has_location(location_id));

create policy services_manage_for_managers
on app.services for all to authenticated
using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));

create policy prices_select_for_members
on app.service_price_versions for select to authenticated
using (private.user_has_location(location_id));

create policy prices_insert_for_managers
on app.service_price_versions for insert to authenticated
with check (private.is_manager_at(location_id));

grant select on app.service_categories, app.services,
  app.service_price_versions to authenticated;
grant insert, update, delete on app.service_categories, app.services to authenticated;
grant insert on app.service_price_versions to authenticated;

create or replace function app.create_service_price_version(
  target_service_id uuid,
  new_listed_price numeric,
  starts_at timestamptz,
  reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  created_price_id uuid;
begin
  select location_id
  into target_location_id
  from app.services
  where id = target_service_id
  for update;

  if target_location_id is null
    or not private.is_manager_at(target_location_id) then
    raise exception 'Manager access required';
  end if;

  if new_listed_price < 0 then
    raise exception 'Price cannot be negative';
  end if;

  if char_length(trim(reason)) = 0 then
    raise exception 'A change reason is required';
  end if;

  update app.service_price_versions
  set effective_until = starts_at
  where service_id = target_service_id
    and effective_from < starts_at
    and (effective_until is null or effective_until > starts_at);

  insert into app.service_price_versions (
    service_id,
    location_id,
    listed_price,
    effective_from,
    changed_by,
    change_reason
  )
  values (
    target_service_id,
    target_location_id,
    new_listed_price,
    starts_at,
    (select auth.uid()),
    trim(reason)
  )
  returning id into created_price_id;

  return created_price_id;
end;
$$;

revoke all on function app.create_service_price_version(
  uuid,
  numeric,
  timestamptz,
  text
) from public;

grant execute on function app.create_service_price_version(
  uuid,
  numeric,
  timestamptz,
  text
) to authenticated;

create or replace function app.create_service_with_price(
  target_location_id uuid,
  target_category_id uuid,
  service_name text,
  calculation app.turn_calculation_type,
  duration_minutes integer,
  initial_listed_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_service_id uuid;
begin
  if not private.is_manager_at(target_location_id) then
    raise exception 'Manager access required';
  end if;

  if not exists (
    select 1
    from app.service_categories
    where id = target_category_id
      and location_id = target_location_id
      and active
  ) then
    raise exception 'Category is not active at this location';
  end if;

  insert into app.services (
    location_id,
    category_id,
    name,
    turn_calculation,
    typical_duration_minutes
  )
  values (
    target_location_id,
    target_category_id,
    trim(service_name),
    calculation,
    duration_minutes
  )
  returning id into created_service_id;

  insert into app.service_price_versions (
    service_id,
    location_id,
    listed_price,
    effective_from,
    changed_by,
    change_reason
  )
  values (
    created_service_id,
    target_location_id,
    initial_listed_price,
    now(),
    (select auth.uid()),
    'Initial service price'
  );

  return created_service_id;
end;
$$;

revoke all on function app.create_service_with_price(
  uuid,
  uuid,
  text,
  app.turn_calculation_type,
  integer,
  numeric
) from public;

grant execute on function app.create_service_with_price(
  uuid,
  uuid,
  text,
  app.turn_calculation_type,
  integer,
  numeric
) to authenticated;
