create type app.visit_type as enum (
  'walk_in',
  'appointment',
  'requested_walk_in',
  'requested_appointment'
);
create type app.visit_status as enum (
  'waiting',
  'recommended',
  'assigned',
  'in_service',
  'completed',
  'cancelled',
  'no_show'
);

create table app.customers (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  display_name text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (display_name is null or char_length(trim(display_name)) between 1 and 120)
);

create table app.customer_visits (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  customer_id uuid references app.customers(id),
  ticket_number integer not null,
  visit_type app.visit_type not null,
  status app.visit_status not null default 'waiting',
  customer_name_snapshot text,
  requested_employee_id uuid,
  arrived_at timestamptz not null default now(),
  notes text,
  created_by uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workday_id, ticket_number),
  unique (id, location_id),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (requested_employee_id, location_id)
    references app.employees(id, location_id)
);

create table app.visit_services (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  location_id uuid not null,
  service_id uuid not null,
  sort_order integer not null default 0,
  status app.visit_status not null default 'waiting',
  created_at timestamptz not null default now(),
  unique (visit_id, service_id),
  unique (id, location_id),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id) on delete cascade,
  foreign key (service_id, location_id)
    references app.services(id, location_id)
);

create table app.appointments (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  customer_id uuid references app.customers(id),
  requested_employee_id uuid,
  scheduled_at timestamptz not null,
  status app.visit_status not null default 'waiting',
  arrived_visit_id uuid,
  cancellation_reason text,
  no_show_reason text,
  created_by uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (requested_employee_id, location_id)
    references app.employees(id, location_id),
  foreign key (arrived_visit_id, location_id)
    references app.customer_visits(id, location_id)
);

create table app.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references app.appointments(id) on delete cascade,
  service_id uuid not null,
  location_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (appointment_id, service_id),
  foreign key (service_id, location_id)
    references app.services(id, location_id)
);

create trigger customers_set_updated_at
before update on app.customers
for each row execute function private.set_updated_at();
create trigger customer_visits_set_updated_at
before update on app.customer_visits
for each row execute function private.set_updated_at();
create trigger appointments_set_updated_at
before update on app.appointments
for each row execute function private.set_updated_at();

alter table app.customers enable row level security;
alter table app.customer_visits enable row level security;
alter table app.visit_services enable row level security;
alter table app.appointments enable row level security;
alter table app.appointment_services enable row level security;

create policy customers_select_for_members
on app.customers for select to authenticated
using (private.user_has_location(location_id));
create policy visits_select_for_members
on app.customer_visits for select to authenticated
using (private.user_has_location(location_id));
create policy visit_services_select_for_members
on app.visit_services for select to authenticated
using (private.user_has_location(location_id));
create policy appointments_select_for_members
on app.appointments for select to authenticated
using (private.user_has_location(location_id));
create policy appointment_services_select_for_members
on app.appointment_services for select to authenticated
using (private.user_has_location(location_id));

grant select on app.customers, app.customer_visits, app.visit_services,
  app.appointments, app.appointment_services to authenticated;

alter publication supabase_realtime add table app.customer_visits;

comment on table app.customer_visits is
  'Arrival record for anonymous or named walk-ins, appointments, and requested customers.';
comment on table app.visit_services is
  'One or more requested service lines used as a unit for the initial recommendation.';
