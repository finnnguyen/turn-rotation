create type app.skip_type as enum (
  'unqualified',
  'customer_declined',
  'approved_break',
  'approved_restriction',
  'busy_over_limit',
  'employee_refusal',
  'busy_only_inactive',
  'manager_override',
  'assigned_to_customer',
  'other'
);
create type app.correction_request_status as enum (
  'pending',
  'needs_information',
  'approved',
  'rejected',
  'applied'
);

create table app.busy_mode_periods (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  started_by uuid not null references app.user_profiles(id),
  ended_by uuid references app.user_profiles(id),
  end_reason text,
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  check (ended_at is null or ended_at >= started_at)
);
create unique index busy_mode_one_active_per_workday
  on app.busy_mode_periods (workday_id) where ended_at is null;

create table app.skip_events (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  visit_id uuid,
  decision_id uuid,
  employee_id uuid not null,
  skip_type app.skip_type not null,
  position_changed boolean not null default false,
  explanation text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid not null references app.user_profiles(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id),
  foreign key (decision_id, location_id)
    references app.assignment_decisions(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id)
);

create table app.refusal_events (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  visit_id uuid not null,
  decision_id uuid not null,
  employee_id uuid not null,
  approved_inability boolean not null default false,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  master_position_before integer,
  master_position_after integer,
  state_version bigint not null,
  actor_id uuid not null references app.user_profiles(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id),
  foreign key (decision_id, location_id)
    references app.assignment_decisions(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id)
);

create table app.correction_requests (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  requested_by uuid not null references app.user_profiles(id),
  description text not null check (char_length(trim(description)) between 1 and 1000),
  status app.correction_request_status not null default 'pending',
  manager_response text,
  reviewed_by uuid references app.user_profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id)
);

create table app.corrections (
  id uuid primary key default gen_random_uuid(),
  correction_request_id uuid references app.correction_requests(id),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  original_dollar_balance numeric(10, 2) not null,
  corrected_dollar_balance numeric(10, 2) not null,
  original_haircut_balance numeric(8, 6) not null,
  corrected_haircut_balance numeric(8, 6) not null,
  position_changed boolean not null default false,
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  state_version bigint not null,
  applied_by uuid not null references app.user_profiles(id),
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  check (corrected_dollar_balance >= 0),
  check (corrected_haircut_balance >= 0)
);

create table audit.audit_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  workday_id uuid references app.workdays(id),
  actor_id uuid not null references app.user_profiles(id),
  employee_id uuid references app.employees(id),
  visit_id uuid references app.customer_visits(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create trigger correction_requests_set_updated_at
before update on app.correction_requests
for each row execute function private.set_updated_at();

alter table app.busy_mode_periods enable row level security;
alter table app.skip_events enable row level security;
alter table app.refusal_events enable row level security;
alter table app.correction_requests enable row level security;
alter table app.corrections enable row level security;
alter table audit.audit_events enable row level security;

create policy busy_mode_select_for_members on app.busy_mode_periods
for select to authenticated using (private.user_has_location(location_id));
create policy skips_select_for_members on app.skip_events
for select to authenticated using (private.user_has_location(location_id));
create policy refusals_select_for_members on app.refusal_events
for select to authenticated using (private.user_has_location(location_id));
create policy correction_requests_select_for_members on app.correction_requests
for select to authenticated using (
  private.is_manager_at(location_id)
  or requested_by = (select auth.uid())
  or exists (
    select 1 from app.employees employee
    where employee.id = correction_requests.employee_id
      and employee.user_id = (select auth.uid())
  )
);
create policy corrections_select_for_members on app.corrections
for select to authenticated using (
  private.is_manager_at(location_id)
  or exists (
    select 1 from app.employees employee
    where employee.id = corrections.employee_id
      and employee.user_id = (select auth.uid())
  )
);
create policy audit_select_for_managers on audit.audit_events
for select to authenticated using (private.is_manager_at(location_id));

grant select on app.busy_mode_periods, app.skip_events, app.refusal_events,
  app.correction_requests, app.corrections to authenticated;
grant usage on schema audit to authenticated;
grant select on audit.audit_events to authenticated;

alter table app.assignment_reservations drop constraint assignment_reservations_visit_id_key;
alter table app.assignment_reservations
  add constraint assignment_reservations_visit_employee_key
  unique (visit_id, employee_id);

create or replace function app.set_busy_mode(
  target_workday_id uuid,
  activate boolean,
  mode_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  period_id uuid;
begin
  select location_id into target_location_id
  from app.workdays where id = target_workday_id and status = 'open';
  if target_location_id is null or not private.is_manager_at(target_location_id) then
    raise exception 'Manager access required for an open workday';
  end if;
  if nullif(trim(mode_reason), '') is null then
    raise exception 'A busy-mode reason is required';
  end if;

  if activate then
    insert into app.busy_mode_periods (
      workday_id, location_id, reason, started_by
    ) values (
      target_workday_id, target_location_id, trim(mode_reason), (select auth.uid())
    ) returning id into period_id;
  else
    update app.busy_mode_periods
    set ended_at = now(), ended_by = (select auth.uid()),
        end_reason = trim(mode_reason)
    where workday_id = target_workday_id and ended_at is null
    returning id into period_id;
    if period_id is null then raise exception 'Busy mode is not active'; end if;
  end if;

  insert into audit.audit_events (
    location_id, workday_id, actor_id, event_type, entity_type,
    entity_id, summary, details
  ) values (
    target_location_id, target_workday_id, (select auth.uid()),
    case when activate then 'busy_mode_started' else 'busy_mode_ended' end,
    'busy_mode_period', period_id,
    case when activate then 'Busy mode activated' else 'Busy mode ended' end,
    jsonb_build_object('reason', trim(mode_reason))
  );
  return period_id;
end;
$$;

create or replace function app.record_employee_refusal(
  target_decision_id uuid,
  target_employee_id uuid,
  refusal_reason text,
  approved_inability boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision app.assignment_decisions%rowtype;
  next_version bigint;
  old_position integer;
  new_position integer;
  move_record record;
  refusal_id uuid;
begin
  select * into decision from app.assignment_decisions
  where id = target_decision_id for update;
  if decision.id is null or not private.is_manager_at(decision.location_id) then
    raise exception 'Manager access required';
  end if;
  if nullif(trim(refusal_reason), '') is null then
    raise exception 'A refusal reason is required';
  end if;
  if not exists (
    select 1 from app.assignment_candidates
    where decision_id = decision.id and employee_id = target_employee_id
      and outcome in ('recommended', 'eligible')
  ) then raise exception 'Employee was not an eligible candidate'; end if;

  next_version := private.lock_and_increment_rotation(decision.workday_id);
  select master_position into old_position from app.rotation_entries
  where workday_id = decision.workday_id and employee_id = target_employee_id;

  if not approved_inability then
    select * into move_record from private.move_master_to_end(
      decision.workday_id, target_employee_id, next_version
    );
    new_position := move_record.position_after;
    insert into app.rotation_events (
      workday_id, location_id, employee_id, rotation_type, event_type,
      position_before, position_after, state_version, explanation, details, actor_id
    ) values (
      decision.workday_id, decision.location_id, target_employee_id,
      'master', 'refusal_penalty', move_record.position_before,
      move_record.position_after, next_version,
      'Unapproved refusal moved the employee to the end of the master rotation',
      jsonb_build_object('decision_id', decision.id, 'reason', trim(refusal_reason)),
      (select auth.uid())
    );
  else
    new_position := old_position;
  end if;

  insert into app.refusal_events (
    workday_id, location_id, visit_id, decision_id, employee_id,
    approved_inability, reason, master_position_before,
    master_position_after, state_version, actor_id
  ) values (
    decision.workday_id, decision.location_id, decision.visit_id, decision.id,
    target_employee_id, approved_inability, trim(refusal_reason),
    old_position, new_position, next_version, (select auth.uid())
  ) returning id into refusal_id;

  insert into app.skip_events (
    workday_id, location_id, visit_id, decision_id, employee_id,
    skip_type, position_changed, explanation, actor_id
  ) values (
    decision.workday_id, decision.location_id, decision.visit_id, decision.id,
    target_employee_id, case when approved_inability
      then 'approved_restriction'::app.skip_type
      else 'employee_refusal'::app.skip_type end,
    not approved_inability,
    case when approved_inability
      then 'Manager-approved inability; rotation position retained'
      else 'Employee refused eligible customer; moved to master end' end,
    (select auth.uid())
  );

  insert into audit.audit_events (
    location_id, workday_id, actor_id, employee_id, visit_id,
    event_type, entity_type, entity_id, summary, details
  ) values (
    decision.location_id, decision.workday_id, (select auth.uid()),
    target_employee_id, decision.visit_id, 'employee_refusal',
    'refusal_event', refusal_id,
    case when approved_inability then 'Approved inability recorded'
      else 'Unapproved refusal penalty recorded' end,
    jsonb_build_object('reason', trim(refusal_reason))
  );

  perform app.refresh_visit_recommendation(decision.visit_id);
  return jsonb_build_object('refusal_id', refusal_id, 'state_version', next_version);
end;
$$;

create or replace function app.convert_customer_decline(
  target_decision_id uuid,
  rejected_employee_id uuid,
  requested_employee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision app.assignment_decisions%rowtype;
  refreshed jsonb;
begin
  select * into decision from app.assignment_decisions
  where id = target_decision_id for update;
  if decision.id is null or not private.is_manager_at(decision.location_id) then
    raise exception 'Manager access required';
  end if;
  if rejected_employee_id = requested_employee_id then
    raise exception 'Choose a different requested employee';
  end if;

  insert into app.skip_events (
    workday_id, location_id, visit_id, decision_id, employee_id,
    skip_type, position_changed, explanation, actor_id
  ) values (
    decision.workday_id, decision.location_id, decision.visit_id, decision.id,
    rejected_employee_id, 'customer_declined', false,
    'Customer declined the recommendation; employee retained rotation position',
    (select auth.uid())
  );

  update app.customer_visits
  set visit_type = case when visit_type = 'appointment'
      then 'requested_appointment'::app.visit_type
      else 'requested_walk_in'::app.visit_type end,
      requested_employee_id = convert_customer_decline.requested_employee_id
  where id = decision.visit_id;

  refreshed := app.refresh_visit_recommendation(decision.visit_id);
  return refreshed;
end;
$$;

create or replace function app.reassign_unstarted_service(
  target_assignment_id uuid,
  target_employee_id uuid,
  reassignment_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment app.service_assignments%rowtype;
  service_id uuid;
  old_employee_id uuid;
begin
  select * into assignment from app.service_assignments
  where id = target_assignment_id for update;
  if assignment.id is null or not private.is_manager_at(assignment.location_id) then
    raise exception 'Manager access required';
  end if;
  if assignment.status <> 'assigned' then
    raise exception 'Only an unstarted service can be reassigned';
  end if;
  if nullif(trim(reassignment_reason), '') is null then
    raise exception 'A reassignment reason is required';
  end if;
  select visit_service.service_id into service_id from app.visit_services visit_service
  where visit_service.id = assignment.visit_service_id;
  if private.effective_qualification(target_employee_id, service_id, now())
    not in ('primary', 'general') then
    raise exception 'Target employee is not currently qualified';
  end if;
  if not exists (
    select 1 from app.rotation_entries entry
    where entry.workday_id = (
      select visit.workday_id from app.customer_visits visit
      where visit.id = assignment.visit_id
    ) and entry.employee_id = target_employee_id
      and entry.master_position is not null
      and entry.current_status = 'available'
  ) then raise exception 'Target employee is not available'; end if;

  old_employee_id := assignment.employee_id;
  insert into app.assignment_reservations (
    visit_id, decision_id, location_id, employee_id, created_by
  ) values (
    assignment.visit_id, assignment.decision_id, assignment.location_id,
    target_employee_id, (select auth.uid())
  ) on conflict (visit_id, employee_id) do nothing;

  update app.service_assignments set employee_id = target_employee_id
  where id = assignment.id;
  insert into app.service_transfers (
    assignment_id, from_employee_id, to_employee_id, reason, transferred_by
  ) values (
    assignment.id, old_employee_id, target_employee_id,
    trim(reassignment_reason), (select auth.uid())
  );

  if not exists (
    select 1 from app.service_assignments
    where visit_id = assignment.visit_id and employee_id = old_employee_id
      and status in ('assigned', 'started')
  ) then
    update app.assignment_reservations
    set released_at = now(), release_reason = 'All service lines reassigned'
    where visit_id = assignment.visit_id and employee_id = old_employee_id
      and released_at is null;
  end if;
  return assignment.id;
end;
$$;

create or replace function app.apply_balance_correction(
  target_workday_id uuid,
  target_employee_id uuid,
  corrected_dollar_balance numeric,
  corrected_haircut_balance numeric,
  correction_reason text,
  move_to_master_end boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  old_dollar numeric(10, 2);
  old_haircut numeric(8, 6);
  next_version bigint;
  correction_id uuid;
begin
  select location_id into target_location_id from app.workdays
  where id = target_workday_id and status = 'open';
  if target_location_id is null or not private.is_manager_at(target_location_id) then
    raise exception 'Manager access required';
  end if;
  if corrected_dollar_balance < 0 or corrected_haircut_balance < 0 then
    raise exception 'Corrected balances cannot be negative';
  end if;
  if nullif(trim(correction_reason), '') is null then
    raise exception 'A correction reason is required';
  end if;

  select dollar_balance, haircut_balance into old_dollar, old_haircut
  from app.rotation_entries where workday_id = target_workday_id
    and employee_id = target_employee_id for update;
  if old_dollar is null then raise exception 'Employee is not in this workday'; end if;
  next_version := private.lock_and_increment_rotation(target_workday_id);

  update app.rotation_entries set dollar_balance = corrected_dollar_balance,
    haircut_balance = corrected_haircut_balance, state_version = next_version
  where workday_id = target_workday_id and employee_id = target_employee_id;
  if move_to_master_end then
    perform private.move_master_to_end(
      target_workday_id, target_employee_id, next_version
    );
  end if;

  insert into app.corrections (
    workday_id, location_id, employee_id, original_dollar_balance,
    corrected_dollar_balance, original_haircut_balance,
    corrected_haircut_balance, position_changed, reason,
    state_version, applied_by
  ) values (
    target_workday_id, target_location_id, target_employee_id, old_dollar,
    corrected_dollar_balance, old_haircut, corrected_haircut_balance,
    move_to_master_end, trim(correction_reason), next_version, (select auth.uid())
  ) returning id into correction_id;

  insert into app.turn_credit_events (
    workday_id, location_id, employee_id, credit_type,
    dollar_balance_before, dollar_balance_after, haircut_balance_before,
    haircut_balance_after, state_version, explanation, details, actor_id
  ) values (
    target_workday_id, target_location_id, target_employee_id, 'correction',
    old_dollar, corrected_dollar_balance, old_haircut,
    corrected_haircut_balance, next_version,
    'Manager applied a compensating balance correction',
    jsonb_build_object('correction_id', correction_id, 'reason', trim(correction_reason)),
    (select auth.uid())
  );
  insert into audit.audit_events (
    location_id, workday_id, actor_id, employee_id, event_type,
    entity_type, entity_id, summary, details
  ) values (
    target_location_id, target_workday_id, (select auth.uid()),
    target_employee_id, 'balance_correction', 'correction', correction_id,
    'Manager applied balance correction',
    jsonb_build_object(
      'old_dollar', old_dollar, 'new_dollar', corrected_dollar_balance,
      'old_haircut', old_haircut, 'new_haircut', corrected_haircut_balance
    )
  );
  return correction_id;
end;
$$;

revoke all on function app.set_busy_mode(uuid, boolean, text) from public;
revoke all on function app.record_employee_refusal(uuid, uuid, text, boolean) from public;
revoke all on function app.convert_customer_decline(uuid, uuid, uuid) from public;
revoke all on function app.reassign_unstarted_service(uuid, uuid, text) from public;
revoke all on function app.apply_balance_correction(
  uuid, uuid, numeric, numeric, text, boolean
) from public;
grant execute on function app.set_busy_mode(uuid, boolean, text) to authenticated;
grant execute on function app.record_employee_refusal(uuid, uuid, text, boolean)
  to authenticated;
grant execute on function app.convert_customer_decline(uuid, uuid, uuid)
  to authenticated;
grant execute on function app.reassign_unstarted_service(uuid, uuid, text)
  to authenticated;
grant execute on function app.apply_balance_correction(
  uuid, uuid, numeric, numeric, text, boolean
) to authenticated;

alter publication supabase_realtime add table app.busy_mode_periods;

comment on table audit.audit_events is
  'Append-only manager audit history; application roles receive no mutation grants.';
