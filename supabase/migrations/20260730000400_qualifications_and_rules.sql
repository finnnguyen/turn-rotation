create table app.employee_qualifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  location_id uuid not null references app.salon_locations(id),
  service_id uuid,
  category_id uuid,
  level app.qualification_level not null,
  skill_level smallint check (skill_level between 1 and 5),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  notes text,
  changed_by uuid references app.user_profiles(id),
  created_at timestamptz not null default now(),
  check ((service_id is null) <> (category_id is null)),
  check (effective_until is null or effective_until > effective_from),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  foreign key (service_id, location_id)
    references app.services(id, location_id),
  foreign key (category_id, location_id)
    references app.service_categories(id, location_id)
);

alter table app.employee_qualifications
  add constraint employee_service_qualification_ranges_do_not_overlap
  exclude using gist (
    employee_id with =,
    service_id with =,
    tstzrange(effective_from, effective_until, '[)') with &&
  ) where (service_id is not null);

alter table app.employee_qualifications
  add constraint employee_category_qualification_ranges_do_not_overlap
  exclude using gist (
    employee_id with =,
    category_id with =,
    tstzrange(effective_from, effective_until, '[)') with &&
  ) where (category_id is not null);

create table app.daily_qualification_overrides (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  location_id uuid not null references app.salon_locations(id),
  service_id uuid,
  category_id uuid,
  level app.qualification_level not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  approved_by uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  check ((service_id is null) <> (category_id is null)),
  check (ends_at > starts_at),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  foreign key (service_id, location_id)
    references app.services(id, location_id),
  foreign key (category_id, location_id)
    references app.service_categories(id, location_id)
);

create table app.rule_set_versions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  effective_from timestamptz not null,
  effective_until timestamptz,
  dollar_threshold numeric(10, 2) not null default 30 check (dollar_threshold > 0),
  exact_threshold_qualifies boolean not null default true,
  carry_excess_value boolean not null default false,
  mens_haircut_fraction numeric(8, 6) not null default (1.0 / 3.0),
  womens_haircut_fraction numeric(8, 6) not null default 0.5,
  partials_carry_to_next_day boolean not null default false,
  wait_limit_minutes integer not null default 15 check (wait_limit_minutes between 1 and 120),
  requested_services_affect_rotation boolean not null default true,
  requested_haircuts_advance_rotation boolean not null default true,
  created_by uuid references app.user_profiles(id),
  change_reason text not null check (char_length(trim(change_reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from),
  exclude using gist (
    location_id with =,
    tstzrange(effective_from, effective_until, '[)') with &&
  )
);

alter table app.employee_qualifications enable row level security;
alter table app.daily_qualification_overrides enable row level security;
alter table app.rule_set_versions enable row level security;

create policy qualifications_select_for_members
on app.employee_qualifications for select to authenticated
using (private.user_has_location(location_id));

create policy qualifications_manage_for_managers
on app.employee_qualifications for all to authenticated
using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));

create policy daily_overrides_select_for_members
on app.daily_qualification_overrides for select to authenticated
using (private.user_has_location(location_id));

create policy daily_overrides_manage_for_managers
on app.daily_qualification_overrides for all to authenticated
using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));

create policy rules_select_for_members
on app.rule_set_versions for select to authenticated
using (private.user_has_location(location_id));

create policy rules_insert_for_managers
on app.rule_set_versions for insert to authenticated
with check (private.is_manager_at(location_id));

grant select on app.employee_qualifications,
  app.daily_qualification_overrides, app.rule_set_versions to authenticated;
grant insert, update, delete on app.employee_qualifications,
  app.daily_qualification_overrides to authenticated;
grant insert on app.rule_set_versions to authenticated;

create or replace function app.set_employee_category_qualification(
  target_employee_id uuid,
  target_category_id uuid,
  new_level app.qualification_level,
  starts_at timestamptz,
  qualification_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  category_location_id uuid;
  created_qualification_id uuid;
begin
  select location_id
  into target_location_id
  from app.employees
  where id = target_employee_id
  for update;

  select location_id
  into category_location_id
  from app.service_categories
  where id = target_category_id;

  if target_location_id is null
    or target_location_id <> category_location_id
    or not private.is_manager_at(target_location_id) then
    raise exception 'Manager access required for this employee and category';
  end if;

  update app.employee_qualifications
  set effective_until = starts_at
  where employee_id = target_employee_id
    and category_id = target_category_id
    and effective_from < starts_at
    and (effective_until is null or effective_until > starts_at);

  insert into app.employee_qualifications (
    employee_id,
    location_id,
    category_id,
    level,
    effective_from,
    notes,
    changed_by
  )
  values (
    target_employee_id,
    target_location_id,
    target_category_id,
    new_level,
    starts_at,
    nullif(trim(qualification_notes), ''),
    (select auth.uid())
  )
  returning id into created_qualification_id;

  return created_qualification_id;
end;
$$;

revoke all on function app.set_employee_category_qualification(
  uuid,
  uuid,
  app.qualification_level,
  timestamptz,
  text
) from public;

grant execute on function app.set_employee_category_qualification(
  uuid,
  uuid,
  app.qualification_level,
  timestamptz,
  text
) to authenticated;
