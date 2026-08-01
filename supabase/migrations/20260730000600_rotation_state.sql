create type app.rotation_type as enum ('master', 'haircut');
create type app.rotation_event_type as enum (
  'joined',
  'haircut_advanced',
  'full_turn_completed',
  'refusal_penalty',
  'busy_skip',
  'temporary_skip',
  'returned',
  'clocked_out',
  'manager_correction',
  'day_closed'
);

create table app.rotation_state_versions (
  workday_id uuid primary key references app.workdays(id),
  location_id uuid not null references app.salon_locations(id),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  unique (workday_id, location_id)
);

create table app.rotation_entries (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  master_position integer,
  haircut_position integer,
  dollar_balance numeric(10, 2) not null default 0,
  haircut_balance numeric(8, 6) not null default 0,
  current_status app.employee_status not null default 'available',
  state_version bigint not null default 0,
  first_clocked_in_at timestamptz not null default now(),
  last_clocked_in_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workday_id, employee_id),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  check (master_position is null or master_position > 0),
  check (haircut_position is null or haircut_position > 0),
  check (dollar_balance >= 0),
  check (haircut_balance >= 0)
);

create unique index rotation_entries_master_position
  on app.rotation_entries (workday_id, master_position)
  where master_position is not null;

create unique index rotation_entries_haircut_position
  on app.rotation_entries (workday_id, haircut_position)
  where haircut_position is not null;

create table app.rotation_events (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  rotation_type app.rotation_type not null,
  event_type app.rotation_event_type not null,
  position_before integer,
  position_after integer,
  state_version bigint not null,
  explanation text not null check (char_length(trim(explanation)) > 0),
  details jsonb not null default '{}'::jsonb,
  actor_id uuid not null references app.user_profiles(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id)
);

create index rotation_events_workday_version
  on app.rotation_events (workday_id, state_version, occurred_at);

create trigger rotation_entries_set_updated_at
before update on app.rotation_entries
for each row execute function private.set_updated_at();

alter table app.rotation_state_versions enable row level security;
alter table app.rotation_entries enable row level security;
alter table app.rotation_events enable row level security;

create policy rotation_versions_select_for_members
on app.rotation_state_versions for select to authenticated
using (private.user_has_location(location_id));

create policy rotation_entries_select_for_members
on app.rotation_entries for select to authenticated
using (private.user_has_location(location_id));

create policy rotation_events_select_for_members
on app.rotation_events for select to authenticated
using (private.user_has_location(location_id));

grant select on app.rotation_state_versions,
  app.rotation_entries, app.rotation_events to authenticated;

create or replace function private.assert_employee_command_access(
  target_location_id uuid,
  target_employee_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if target_location_id is null then
    raise exception 'Open workday not found';
  end if;

  if not private.user_has_location(target_location_id) then
    raise exception 'Location access required';
  end if;

  if not private.is_manager_at(target_location_id)
    and not exists (
      select 1 from app.employees
      where id = target_employee_id
        and location_id = target_location_id
        and user_id = (select auth.uid())
    ) then
    raise exception 'You may only update your own work status';
  end if;
end;
$$;

create or replace function private.employee_has_haircut_qualification(
  target_employee_id uuid,
  at_time timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.employee_qualifications qualification
    join app.service_categories category
      on category.id = qualification.category_id
    where qualification.employee_id = target_employee_id
      and category.name in ('Men''s haircuts', 'Women''s haircuts')
      and qualification.level in ('primary', 'general')
      and qualification.effective_from <= at_time
      and (qualification.effective_until is null or qualification.effective_until > at_time)
  );
$$;

create or replace function private.lock_and_increment_rotation(
  target_workday_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version bigint;
begin
  update app.rotation_state_versions
  set version = version + 1, updated_at = now()
  where workday_id = target_workday_id
  returning version into next_version;

  if next_version is null then
    raise exception 'Rotation state not found';
  end if;

  return next_version;
end;
$$;

create or replace function app.open_workday(
  target_location_id uuid,
  target_business_date date default null,
  workday_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_workday_id uuid;
  active_rule_id uuid;
  location_timezone text;
  resolved_date date;
begin
  if not private.is_manager_at(target_location_id) then
    raise exception 'Manager access required to open a workday';
  end if;

  select timezone into location_timezone
  from app.salon_locations
  where id = target_location_id and active
  for update;

  if location_timezone is null then
    raise exception 'Active salon location not found';
  end if;

  resolved_date := coalesce(target_business_date, (now() at time zone location_timezone)::date);

  select id into active_rule_id
  from app.rule_set_versions
  where location_id = target_location_id
    and effective_from <= now()
    and (effective_until is null or effective_until > now())
  order by effective_from desc
  limit 1;

  if active_rule_id is null then
    raise exception 'No active rule set exists for this location';
  end if;

  insert into app.workdays (
    location_id, business_date, status, rule_set_version_id,
    opened_by, notes
  )
  values (
    target_location_id, resolved_date, 'open', active_rule_id,
    (select auth.uid()), nullif(trim(workday_notes), '')
  )
  returning id into created_workday_id;

  insert into app.rotation_state_versions (workday_id, location_id)
  values (created_workday_id, target_location_id);

  return created_workday_id;
end;
$$;

create or replace function app.clock_in_employee(
  target_workday_id uuid,
  target_employee_id uuid,
  event_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  target_status app.workday_status;
  new_master_position integer;
  new_haircut_position integer;
  next_version bigint;
  clock_event app.clock_event_type;
  rotation_event app.rotation_event_type;
  already_active boolean;
begin
  select location_id, status into target_location_id, target_status
  from app.workdays where id = target_workday_id;

  perform private.assert_employee_command_access(target_location_id, target_employee_id);

  if target_status <> 'open' then
    raise exception 'Employees can only clock in to an open workday';
  end if;

  if not exists (
    select 1 from app.employees
    where id = target_employee_id and location_id = target_location_id and active
  ) then
    raise exception 'Active employee not found at this location';
  end if;

  select exists (
    select 1 from app.rotation_entries
    where workday_id = target_workday_id
      and employee_id = target_employee_id
      and master_position is not null
  ) into already_active;

  if already_active then
    raise exception 'Employee is already clocked in';
  end if;

  next_version := private.lock_and_increment_rotation(target_workday_id);

  select coalesce(max(master_position), 0) + 1 into new_master_position
  from app.rotation_entries where workday_id = target_workday_id;

  if private.employee_has_haircut_qualification(target_employee_id, now()) then
    select coalesce(max(haircut_position), 0) + 1 into new_haircut_position
    from app.rotation_entries where workday_id = target_workday_id;
  end if;

  if exists (
    select 1 from app.rotation_entries
    where workday_id = target_workday_id and employee_id = target_employee_id
  ) then
    clock_event := 'return';
    rotation_event := 'returned';
    update app.rotation_entries
    set master_position = new_master_position,
        haircut_position = new_haircut_position,
        current_status = 'available',
        state_version = next_version,
        last_clocked_in_at = now()
    where workday_id = target_workday_id and employee_id = target_employee_id;
  else
    clock_event := 'clock_in';
    rotation_event := 'joined';
    insert into app.rotation_entries (
      workday_id, location_id, employee_id, master_position,
      haircut_position, current_status, state_version
    ) values (
      target_workday_id, target_location_id, target_employee_id,
      new_master_position, new_haircut_position, 'available', next_version
    );
  end if;

  update app.employee_status_events set ended_at = now()
  where workday_id = target_workday_id
    and employee_id = target_employee_id
    and ended_at is null;

  insert into app.employee_status_events (
    workday_id, location_id, employee_id, status, actor_id, reason
  ) values (
    target_workday_id, target_location_id, target_employee_id,
    'available', (select auth.uid()), nullif(trim(event_notes), '')
  );

  insert into app.clock_events (
    workday_id, location_id, employee_id, event_type, actor_id, notes
  ) values (
    target_workday_id, target_location_id, target_employee_id,
    clock_event, (select auth.uid()), nullif(trim(event_notes), '')
  );

  insert into app.rotation_events (
    workday_id, location_id, employee_id, rotation_type, event_type,
    position_after, state_version, explanation, actor_id
  ) values (
    target_workday_id, target_location_id, target_employee_id, 'master',
    rotation_event, new_master_position, next_version,
    case when clock_event = 'return'
      then 'Returned to the end of the master rotation'
      else 'Joined the master rotation in actual clock-in order'
    end,
    (select auth.uid())
  );

  if new_haircut_position is not null then
    insert into app.rotation_events (
      workday_id, location_id, employee_id, rotation_type, event_type,
      position_after, state_version, explanation, actor_id
    ) values (
      target_workday_id, target_location_id, target_employee_id, 'haircut',
      rotation_event, new_haircut_position, next_version,
      'Joined the shared haircut rotation in actual clock-in order',
      (select auth.uid())
    );
  end if;

  return next_version;
end;
$$;

create or replace function app.set_employee_status(
  target_workday_id uuid,
  target_employee_id uuid,
  new_status app.employee_status,
  status_reason text default null,
  expected_end_at timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  next_version bigint;
begin
  select location_id into target_location_id
  from app.workdays where id = target_workday_id and status = 'open';

  perform private.assert_employee_command_access(target_location_id, target_employee_id);

  if new_status in ('break', 'clocked_out', 'finished') then
    raise exception 'Use the dedicated break or clock-out command';
  end if;

  if not exists (
    select 1 from app.rotation_entries
    where workday_id = target_workday_id
      and employee_id = target_employee_id
      and master_position is not null
  ) then
    raise exception 'Employee is not clocked in';
  end if;

  next_version := private.lock_and_increment_rotation(target_workday_id);

  update app.employee_status_events set ended_at = now()
  where workday_id = target_workday_id
    and employee_id = target_employee_id and ended_at is null;

  insert into app.employee_status_events (
    workday_id, location_id, employee_id, status,
    expected_end_at, reason, actor_id
  ) values (
    target_workday_id, target_location_id, target_employee_id, new_status,
    expected_end_at, nullif(trim(status_reason), ''), (select auth.uid())
  );

  update app.rotation_entries
  set current_status = new_status, state_version = next_version
  where workday_id = target_workday_id and employee_id = target_employee_id;

  return next_version;
end;
$$;

create or replace function app.start_employee_break(
  target_workday_id uuid,
  target_employee_id uuid,
  expected_end_at timestamptz default null,
  break_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  created_status_id uuid;
  next_version bigint;
begin
  select location_id into target_location_id
  from app.workdays where id = target_workday_id and status = 'open';
  perform private.assert_employee_command_access(target_location_id, target_employee_id);

  if not exists (
    select 1 from app.rotation_entries
    where workday_id = target_workday_id
      and employee_id = target_employee_id
      and master_position is not null
  ) then
    raise exception 'Employee is not clocked in';
  end if;

  next_version := private.lock_and_increment_rotation(target_workday_id);

  update app.employee_status_events set ended_at = now()
  where workday_id = target_workday_id
    and employee_id = target_employee_id and ended_at is null;

  insert into app.employee_status_events (
    workday_id, location_id, employee_id, status,
    expected_end_at, reason, actor_id
  ) values (
    target_workday_id, target_location_id, target_employee_id, 'break',
    expected_end_at, nullif(trim(break_notes), ''), (select auth.uid())
  ) returning id into created_status_id;

  insert into app.break_periods (
    status_event_id, workday_id, location_id, employee_id,
    expected_end_at, approved_by, notes
  ) values (
    created_status_id, target_workday_id, target_location_id,
    target_employee_id, expected_end_at, (select auth.uid()),
    nullif(trim(break_notes), '')
  );

  update app.rotation_entries
  set current_status = 'break', state_version = next_version
  where workday_id = target_workday_id and employee_id = target_employee_id;

  return next_version;
end;
$$;

create or replace function app.end_employee_break(
  target_workday_id uuid,
  target_employee_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  next_version bigint;
begin
  select location_id into target_location_id
  from app.workdays where id = target_workday_id and status = 'open';
  perform private.assert_employee_command_access(target_location_id, target_employee_id);

  if not exists (
    select 1 from app.break_periods
    where workday_id = target_workday_id
      and employee_id = target_employee_id and ended_at is null
  ) then
    raise exception 'Employee is not on break';
  end if;

  next_version := private.lock_and_increment_rotation(target_workday_id);

  update app.break_periods
  set ended_at = now(), ended_by = (select auth.uid())
  where workday_id = target_workday_id
    and employee_id = target_employee_id and ended_at is null;

  update app.employee_status_events set ended_at = now()
  where workday_id = target_workday_id
    and employee_id = target_employee_id and ended_at is null;

  insert into app.employee_status_events (
    workday_id, location_id, employee_id, status, actor_id,
    reason
  ) values (
    target_workday_id, target_location_id, target_employee_id,
    'available', (select auth.uid()), 'Returned from approved break'
  );

  update app.rotation_entries
  set current_status = 'available', state_version = next_version
  where workday_id = target_workday_id and employee_id = target_employee_id;

  return next_version;
end;
$$;

create or replace function app.clock_out_employee(
  target_workday_id uuid,
  target_employee_id uuid,
  event_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  old_master_position integer;
  old_haircut_position integer;
  next_version bigint;
begin
  select location_id into target_location_id
  from app.workdays where id = target_workday_id and status = 'open';
  perform private.assert_employee_command_access(target_location_id, target_employee_id);

  select master_position, haircut_position
  into old_master_position, old_haircut_position
  from app.rotation_entries
  where workday_id = target_workday_id and employee_id = target_employee_id
  for update;

  if old_master_position is null then
    raise exception 'Employee is not clocked in';
  end if;

  next_version := private.lock_and_increment_rotation(target_workday_id);

  update app.rotation_entries
  set master_position = null, haircut_position = null,
      current_status = 'clocked_out', state_version = next_version
  where workday_id = target_workday_id and employee_id = target_employee_id;

  update app.rotation_entries
  set master_position = master_position - 1, state_version = next_version
  where workday_id = target_workday_id and master_position > old_master_position;

  if old_haircut_position is not null then
    update app.rotation_entries
    set haircut_position = haircut_position - 1, state_version = next_version
    where workday_id = target_workday_id and haircut_position > old_haircut_position;
  end if;

  update app.employee_status_events set ended_at = now()
  where workday_id = target_workday_id
    and employee_id = target_employee_id and ended_at is null;

  update app.break_periods
  set ended_at = now(), ended_by = (select auth.uid())
  where workday_id = target_workday_id
    and employee_id = target_employee_id and ended_at is null;

  insert into app.employee_status_events (
    workday_id, location_id, employee_id, status, actor_id, reason
  ) values (
    target_workday_id, target_location_id, target_employee_id,
    'clocked_out', (select auth.uid()), nullif(trim(event_notes), '')
  );

  insert into app.clock_events (
    workday_id, location_id, employee_id, event_type, actor_id, notes
  ) values (
    target_workday_id, target_location_id, target_employee_id,
    'clock_out', (select auth.uid()), nullif(trim(event_notes), '')
  );

  insert into app.rotation_events (
    workday_id, location_id, employee_id, rotation_type, event_type,
    position_before, state_version, explanation, actor_id
  ) values (
    target_workday_id, target_location_id, target_employee_id, 'master',
    'clocked_out', old_master_position, next_version,
    'Clocked out; same-day return will join the end while retaining partial credit',
    (select auth.uid())
  );

  return next_version;
end;
$$;

create or replace function app.close_workday(
  target_workday_id uuid,
  closing_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  next_version bigint;
  employee_record record;
begin
  select location_id into target_location_id
  from app.workdays where id = target_workday_id and status = 'open'
  for update;

  if target_location_id is null or not private.is_manager_at(target_location_id) then
    raise exception 'Manager access required to close an open workday';
  end if;

  next_version := private.lock_and_increment_rotation(target_workday_id);

  for employee_record in
    select employee_id, master_position
    from app.rotation_entries
    where workday_id = target_workday_id and master_position is not null
  loop
    insert into app.rotation_events (
      workday_id, location_id, employee_id, rotation_type, event_type,
      position_before, state_version, explanation, actor_id
    ) values (
      target_workday_id, target_location_id, employee_record.employee_id,
      'master', 'day_closed', employee_record.master_position, next_version,
      'Workday closed; all daily positions and partial credits expire',
      (select auth.uid())
    );
  end loop;

  update app.employee_status_events set ended_at = now()
  where workday_id = target_workday_id and ended_at is null;

  update app.break_periods
  set ended_at = now(), ended_by = (select auth.uid())
  where workday_id = target_workday_id and ended_at is null;

  update app.rotation_entries
  set master_position = null, haircut_position = null,
      dollar_balance = 0, haircut_balance = 0,
      current_status = 'finished', state_version = next_version
  where workday_id = target_workday_id;

  update app.workdays
  set status = 'closed', closed_at = now(), closed_by = (select auth.uid()),
      notes = coalesce(nullif(trim(closing_notes), ''), notes)
  where id = target_workday_id;

  return next_version;
end;
$$;

revoke all on function private.assert_employee_command_access(uuid, uuid) from public;
revoke all on function private.employee_has_haircut_qualification(uuid, timestamptz) from public;
revoke all on function private.lock_and_increment_rotation(uuid) from public;

revoke all on function app.open_workday(uuid, date, text) from public;
revoke all on function app.clock_in_employee(uuid, uuid, text) from public;
revoke all on function app.set_employee_status(
  uuid, uuid, app.employee_status, text, timestamptz
) from public;
revoke all on function app.start_employee_break(uuid, uuid, timestamptz, text) from public;
revoke all on function app.end_employee_break(uuid, uuid) from public;
revoke all on function app.clock_out_employee(uuid, uuid, text) from public;
revoke all on function app.close_workday(uuid, text) from public;

grant execute on function app.open_workday(uuid, date, text) to authenticated;
grant execute on function app.clock_in_employee(uuid, uuid, text) to authenticated;
grant execute on function app.set_employee_status(
  uuid, uuid, app.employee_status, text, timestamptz
) to authenticated;
grant execute on function app.start_employee_break(
  uuid, uuid, timestamptz, text
) to authenticated;
grant execute on function app.end_employee_break(uuid, uuid) to authenticated;
grant execute on function app.clock_out_employee(uuid, uuid, text) to authenticated;
grant execute on function app.close_workday(uuid, text) to authenticated;

alter publication supabase_realtime add table app.workdays;
alter publication supabase_realtime add table app.rotation_entries;
alter publication supabase_realtime add table app.employee_status_events;

comment on table app.rotation_entries is
  'Rebuildable current projection. Authoritative changes are captured in append-only events.';
comment on table app.rotation_events is
  'Append-only explanation history for every positional rotation change.';
