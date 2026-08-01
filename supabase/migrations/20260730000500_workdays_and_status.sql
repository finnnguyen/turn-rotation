create type app.workday_status as enum ('preparing', 'open', 'closing', 'closed');
create type app.clock_event_type as enum ('clock_in', 'clock_out', 'return');
create type app.employee_status as enum (
  'available',
  'busy',
  'break',
  'unavailable',
  'not_accepting_walk_ins',
  'finished',
  'clocked_out'
);

create table app.workdays (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  business_date date not null,
  status app.workday_status not null default 'open',
  rule_set_version_id uuid not null references app.rule_set_versions(id),
  opened_at timestamptz not null default now(),
  opened_by uuid not null references app.user_profiles(id),
  closed_at timestamptz,
  closed_by uuid references app.user_profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, location_id),
  unique (location_id, business_date),
  check (
    (status = 'closed' and closed_at is not null and closed_by is not null)
    or (status <> 'closed' and closed_at is null and closed_by is null)
  ),
  check (closed_at is null or closed_at >= opened_at)
);

create unique index workdays_one_active_per_location
  on app.workdays (location_id)
  where status in ('preparing', 'open', 'closing');

create table app.clock_events (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  event_type app.clock_event_type not null,
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references app.user_profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id)
);

create index clock_events_workday_employee_time
  on app.clock_events (workday_id, employee_id, occurred_at);

create table app.employee_status_events (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  status app.employee_status not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  expected_end_at timestamptz,
  reason text,
  actor_id uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  check (ended_at is null or ended_at >= started_at),
  check (expected_end_at is null or expected_end_at >= started_at)
);

create unique index employee_status_one_current
  on app.employee_status_events (workday_id, employee_id)
  where ended_at is null;

create table app.break_periods (
  id uuid primary key default gen_random_uuid(),
  status_event_id uuid not null unique references app.employee_status_events(id),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  started_at timestamptz not null default now(),
  expected_end_at timestamptz,
  ended_at timestamptz,
  approved_by uuid not null references app.user_profiles(id),
  ended_by uuid references app.user_profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  check (ended_at is null or ended_at >= started_at),
  check (expected_end_at is null or expected_end_at >= started_at)
);

create unique index break_periods_one_active
  on app.break_periods (workday_id, employee_id)
  where ended_at is null;

create trigger workdays_set_updated_at
before update on app.workdays
for each row execute function private.set_updated_at();

alter table app.workdays enable row level security;
alter table app.clock_events enable row level security;
alter table app.employee_status_events enable row level security;
alter table app.break_periods enable row level security;

create policy workdays_select_for_members
on app.workdays for select to authenticated
using (private.user_has_location(location_id));

create policy clock_events_select_for_members
on app.clock_events for select to authenticated
using (private.user_has_location(location_id));

create policy status_events_select_for_members
on app.employee_status_events for select to authenticated
using (private.user_has_location(location_id));

create policy breaks_select_for_members
on app.break_periods for select to authenticated
using (private.user_has_location(location_id));

grant select on app.workdays, app.clock_events,
  app.employee_status_events, app.break_periods to authenticated;

comment on table app.clock_events is
  'Append-only attendance history. Commands append events rather than rewriting them.';
comment on table app.employee_status_events is
  'Effective-dated employee availability history; exactly one current status per clocked-in employee.';
