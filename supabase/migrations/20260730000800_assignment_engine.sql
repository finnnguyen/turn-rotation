create type app.assignment_decision_status as enum (
  'recommended',
  'confirmed',
  'superseded',
  'no_candidate'
);
create type app.assignment_candidate_outcome as enum (
  'recommended',
  'eligible',
  'skipped'
);
create type app.assignment_skip_reason as enum (
  'unqualified',
  'busy_only_inactive',
  'clocked_out',
  'finished',
  'unavailable',
  'not_accepting_walk_ins',
  'busy_over_limit',
  'break_over_limit',
  'assigned_to_customer',
  'customer_requested_other_employee'
);
create type app.service_assignment_status as enum (
  'assigned',
  'started',
  'completed',
  'cancelled'
);

create table app.assignment_decisions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  workday_id uuid not null,
  location_id uuid not null,
  status app.assignment_decision_status not null,
  rotation_type app.rotation_type not null,
  expected_state_version bigint not null,
  requested_employee_id uuid,
  recommended_employee_id uuid,
  wait_limit_minutes integer not null,
  estimated_wait_minutes integer,
  explanation text not null,
  service_snapshot jsonb not null,
  rule_snapshot jsonb not null,
  created_by uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (id, location_id),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (requested_employee_id, location_id)
    references app.employees(id, location_id),
  foreign key (recommended_employee_id, location_id)
    references app.employees(id, location_id)
);

create table app.assignment_candidates (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  candidate_order integer not null,
  master_position integer,
  haircut_position integer,
  qualification_level app.qualification_level,
  availability app.employee_status not null,
  estimated_wait_minutes integer,
  outcome app.assignment_candidate_outcome not null,
  skip_reason app.assignment_skip_reason,
  explanation text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (decision_id, employee_id),
  foreign key (decision_id, location_id)
    references app.assignment_decisions(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id)
);

create table app.service_assignments (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  visit_service_id uuid not null,
  decision_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  status app.service_assignment_status not null default 'assigned',
  idempotency_key uuid not null,
  is_override boolean not null default false,
  override_reason text,
  assigned_by uuid not null references app.user_profiles(id),
  assigned_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (visit_service_id),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id),
  foreign key (visit_service_id, location_id)
    references app.visit_services(id, location_id),
  foreign key (decision_id, location_id)
    references app.assignment_decisions(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  check ((is_override and char_length(trim(override_reason)) > 0) or not is_override)
);

create table app.assignment_commands (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  idempotency_key uuid not null,
  decision_id uuid not null,
  result jsonb not null,
  created_by uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (location_id, idempotency_key),
  foreign key (decision_id, location_id)
    references app.assignment_decisions(id, location_id)
);

create table app.service_participants (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references app.service_assignments(id) on delete cascade,
  employee_id uuid not null references app.employees(id),
  allocation_percent numeric(5, 2) not null default 100
    check (allocation_percent > 0 and allocation_percent <= 100),
  created_at timestamptz not null default now(),
  unique (assignment_id, employee_id)
);

create table app.service_transfers (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references app.service_assignments(id),
  from_employee_id uuid not null references app.employees(id),
  to_employee_id uuid not null references app.employees(id),
  reason text not null check (char_length(trim(reason)) > 0),
  transferred_by uuid not null references app.user_profiles(id),
  transferred_at timestamptz not null default now(),
  check (from_employee_id <> to_employee_id)
);

alter table app.assignment_decisions enable row level security;
alter table app.assignment_candidates enable row level security;
alter table app.service_assignments enable row level security;
alter table app.assignment_commands enable row level security;
alter table app.service_participants enable row level security;
alter table app.service_transfers enable row level security;

create policy decisions_select_for_members
on app.assignment_decisions for select to authenticated
using (private.user_has_location(location_id));
create policy candidates_select_for_members
on app.assignment_candidates for select to authenticated
using (private.user_has_location(location_id));
create policy assignments_select_for_members
on app.service_assignments for select to authenticated
using (private.user_has_location(location_id));
create policy assignment_commands_select_for_members
on app.assignment_commands for select to authenticated
using (private.user_has_location(location_id));
create policy participants_select_for_members
on app.service_participants for select to authenticated
using (
  exists (
    select 1 from app.service_assignments assignment
    where assignment.id = service_participants.assignment_id
      and private.user_has_location(assignment.location_id)
  )
);
create policy transfers_select_for_members
on app.service_transfers for select to authenticated
using (
  exists (
    select 1 from app.service_assignments assignment
    where assignment.id = service_transfers.assignment_id
      and private.user_has_location(assignment.location_id)
  )
);

grant select on app.assignment_decisions, app.assignment_candidates,
  app.service_assignments, app.assignment_commands, app.service_participants,
  app.service_transfers to authenticated;

create or replace function private.effective_qualification(
  target_employee_id uuid,
  target_service_id uuid,
  at_time timestamptz
)
returns app.qualification_level
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select category_id from app.services where id = target_service_id
  ),
  ranked as (
    select qualification.level, 1 as priority
    from app.employee_qualifications qualification
    where qualification.employee_id = target_employee_id
      and qualification.service_id = target_service_id
      and qualification.effective_from <= at_time
      and (qualification.effective_until is null or qualification.effective_until > at_time)
    union all
    select qualification.level, 2 as priority
    from app.employee_qualifications qualification
    join target on target.category_id = qualification.category_id
    where qualification.employee_id = target_employee_id
      and qualification.effective_from <= at_time
      and (qualification.effective_until is null or qualification.effective_until > at_time)
  )
  select level from ranked order by priority limit 1;
$$;

create or replace function app.create_visit_and_recommend(
  target_workday_id uuid,
  selected_service_ids uuid[],
  selected_visit_type app.visit_type default 'walk_in',
  customer_name text default null,
  target_requested_employee_id uuid default null,
  visit_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_location_id uuid;
  target_rule app.rule_set_versions%rowtype;
  current_version bigint;
  created_visit_id uuid;
  created_decision_id uuid;
  next_ticket integer;
  selected_rotation app.rotation_type;
  requested_count integer;
  haircut_count integer;
  candidate record;
  service_record record;
  candidate_number integer := 0;
  missing_qualification boolean;
  busy_only_found boolean;
  weakest_qualification app.qualification_level;
  candidate_wait integer;
  candidate_outcome app.assignment_candidate_outcome;
  candidate_skip app.assignment_skip_reason;
  candidate_explanation text;
  chosen_employee_id uuid;
  chosen_wait integer;
  service_snapshot jsonb;
begin
  if not private.is_manager_at((
    select location_id from app.workdays where id = target_workday_id
  )) then
    raise exception 'Manager access required to create a customer visit';
  end if;

  select location_id into target_location_id
  from app.workdays
  where id = target_workday_id and status = 'open'
  for update;

  if target_location_id is null then
    raise exception 'Open workday not found';
  end if;

  if selected_service_ids is null or cardinality(selected_service_ids) = 0 then
    raise exception 'Select at least one service';
  end if;

  if (
    select count(*) from app.services
    where id = any(selected_service_ids)
      and location_id = target_location_id and active
  ) <> cardinality(selected_service_ids) then
    raise exception 'One or more selected services are invalid or inactive';
  end if;

  if selected_visit_type in ('requested_walk_in', 'requested_appointment')
    and target_requested_employee_id is null then
    raise exception 'Requested visits require an employee';
  end if;

  select rules.* into target_rule
  from app.workdays workday
  join app.rule_set_versions rules on rules.id = workday.rule_set_version_id
  where workday.id = target_workday_id;

  select version into current_version
  from app.rotation_state_versions
  where workday_id = target_workday_id;

  select coalesce(max(ticket_number), 0) + 1 into next_ticket
  from app.customer_visits where workday_id = target_workday_id;

  insert into app.customer_visits (
    workday_id, location_id, ticket_number, visit_type, status,
    customer_name_snapshot, requested_employee_id, notes, created_by
  ) values (
    target_workday_id, target_location_id, next_ticket, selected_visit_type,
    'waiting', nullif(trim(customer_name), ''), target_requested_employee_id,
    nullif(trim(visit_notes), ''), (select auth.uid())
  ) returning id into created_visit_id;

  insert into app.visit_services (visit_id, location_id, service_id, sort_order)
  select created_visit_id, target_location_id, service_id, ordinal - 1
  from unnest(selected_service_ids) with ordinality as item(service_id, ordinal);

  select count(*), count(*) filter (
    where turn_calculation in ('mens_haircut', 'womens_haircut')
  ) into requested_count, haircut_count
  from app.services where id = any(selected_service_ids);

  selected_rotation := case
    when requested_count = haircut_count then 'haircut'::app.rotation_type
    else 'master'::app.rotation_type
  end;

  select jsonb_agg(jsonb_build_object(
    'service_id', service.id,
    'name', service.name,
    'calculation', service.turn_calculation,
    'duration_minutes', service.typical_duration_minutes,
    'listed_price', price.listed_price,
    'price_version_id', price.id
  ) order by visit_service.sort_order)
  into service_snapshot
  from app.visit_services visit_service
  join app.services service on service.id = visit_service.service_id
  left join lateral (
    select version.id, version.listed_price
    from app.service_price_versions version
    where version.service_id = service.id
      and version.effective_from <= now()
      and (version.effective_until is null or version.effective_until > now())
    order by version.effective_from desc limit 1
  ) price on true
  where visit_service.visit_id = created_visit_id;

  insert into app.assignment_decisions (
    visit_id, workday_id, location_id, status, rotation_type,
    expected_state_version, requested_employee_id, wait_limit_minutes,
    explanation, service_snapshot, rule_snapshot, created_by
  ) values (
    created_visit_id, target_workday_id, target_location_id, 'no_candidate',
    selected_rotation, current_version, target_requested_employee_id,
    target_rule.wait_limit_minutes, 'No qualified candidate found',
    service_snapshot,
    jsonb_build_object(
      'rule_set_version_id', target_rule.id,
      'wait_limit_minutes', target_rule.wait_limit_minutes,
      'busy_only_active', false
    ),
    (select auth.uid())
  ) returning id into created_decision_id;

  for candidate in
    select entry.*, employee.display_name,
      status_event.expected_end_at
    from app.rotation_entries entry
    join app.employees employee on employee.id = entry.employee_id
    left join app.employee_status_events status_event
      on status_event.workday_id = entry.workday_id
      and status_event.employee_id = entry.employee_id
      and status_event.ended_at is null
    where entry.workday_id = target_workday_id
      and entry.master_position is not null
      and (
        selected_rotation = 'master'
        or entry.haircut_position is not null
      )
    order by
      case when target_requested_employee_id = entry.employee_id then 0 else 1 end,
      case when selected_rotation = 'haircut'
        then entry.haircut_position else entry.master_position end
  loop
    candidate_number := candidate_number + 1;
    missing_qualification := false;
    busy_only_found := false;
    weakest_qualification := null;

    for service_record in
      select service_id
      from unnest(selected_service_ids) as selected(service_id)
    loop
      declare qualification app.qualification_level;
      begin
        qualification := private.effective_qualification(
          candidate.employee_id, service_record.service_id, now()
        );
        if qualification is null or qualification = 'cannot_perform' then
          missing_qualification := true;
        elsif qualification = 'busy_only' then
          busy_only_found := true;
        else
          weakest_qualification := coalesce(weakest_qualification, qualification);
        end if;
      end;
    end loop;

    candidate_wait := case
      when candidate.current_status = 'available' then 0
      when candidate.expected_end_at is not null then
        greatest(0, ceil(extract(epoch from (
          candidate.expected_end_at - now()
        )) / 60.0)::integer)
      else null
    end;
    candidate_outcome := 'eligible';
    candidate_skip := null;

    if target_requested_employee_id is not null
      and candidate.employee_id <> target_requested_employee_id then
      candidate_outcome := 'skipped';
      candidate_skip := 'customer_requested_other_employee';
    elsif missing_qualification then
      candidate_outcome := 'skipped';
      candidate_skip := 'unqualified';
    elsif busy_only_found then
      candidate_outcome := 'skipped';
      candidate_skip := 'busy_only_inactive';
    elsif candidate.current_status = 'clocked_out' then
      candidate_outcome := 'skipped';
      candidate_skip := 'clocked_out';
    elsif candidate.current_status = 'finished' then
      candidate_outcome := 'skipped';
      candidate_skip := 'finished';
    elsif candidate.current_status = 'unavailable' then
      candidate_outcome := 'skipped';
      candidate_skip := 'unavailable';
    elsif candidate.current_status = 'not_accepting_walk_ins'
      and selected_visit_type in ('walk_in', 'requested_walk_in') then
      candidate_outcome := 'skipped';
      candidate_skip := 'not_accepting_walk_ins';
    elsif candidate.current_status = 'busy'
      and (candidate_wait is null or candidate_wait > target_rule.wait_limit_minutes) then
      candidate_outcome := 'skipped';
      candidate_skip := 'busy_over_limit';
    elsif candidate.current_status = 'break'
      and (candidate_wait is null or candidate_wait > target_rule.wait_limit_minutes) then
      candidate_outcome := 'skipped';
      candidate_skip := 'break_over_limit';
    end if;

    if candidate_outcome = 'eligible' and chosen_employee_id is null then
      candidate_outcome := 'recommended';
      chosen_employee_id := candidate.employee_id;
      chosen_wait := candidate_wait;
      candidate_explanation := case
        when coalesce(candidate_wait, 0) = 0
          then 'Next qualified employee is available now'
        else format(
          'Next qualified employee is expected within %s minutes',
          target_rule.wait_limit_minutes
        )
      end;
    elsif candidate_outcome = 'eligible' then
      candidate_explanation := 'Qualified alternate candidate';
    else
      candidate_explanation := replace(candidate_skip::text, '_', ' ');
    end if;

    insert into app.assignment_candidates (
      decision_id, location_id, employee_id, candidate_order,
      master_position, haircut_position, qualification_level,
      availability, estimated_wait_minutes, outcome, skip_reason,
      explanation, details
    ) values (
      created_decision_id, target_location_id, candidate.employee_id,
      candidate_number, candidate.master_position, candidate.haircut_position,
      weakest_qualification, candidate.current_status, candidate_wait,
      candidate_outcome, candidate_skip, candidate_explanation,
      jsonb_build_object('expected_end_at', candidate.expected_end_at)
    );
  end loop;

  update app.assignment_decisions
  set status = (case when chosen_employee_id is null
      then 'no_candidate' else 'recommended' end)::app.assignment_decision_status,
      recommended_employee_id = chosen_employee_id,
      estimated_wait_minutes = chosen_wait,
      explanation = case
        when chosen_employee_id is null
          then 'No currently qualified employee can take all selected services'
        when coalesce(chosen_wait, 0) = 0
          then 'Recommended the next qualified employee who is available now'
        else format(
          'Recommended the next qualified employee because the expected wait is within %s minutes',
          target_rule.wait_limit_minutes
        )
      end
  where id = created_decision_id;

  update app.customer_visits
  set status = (case when chosen_employee_id is null
    then 'waiting' else 'recommended' end)::app.visit_status
  where id = created_visit_id;

  return jsonb_build_object(
    'visit_id', created_visit_id,
    'decision_id', created_decision_id,
    'ticket_number', next_ticket,
    'recommended_employee_id', chosen_employee_id,
    'expected_state_version', current_version
  );
end;
$$;

create or replace function app.confirm_assignment(
  target_decision_id uuid,
  selected_employee_id uuid,
  expected_state_version bigint,
  command_idempotency_key uuid,
  override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision app.assignment_decisions%rowtype;
  current_version bigint;
  assignment_ids jsonb;
  replay_result jsonb;
  override_selected boolean;
begin
  select * into decision
  from app.assignment_decisions
  where id = target_decision_id
  for update;

  if decision.id is null or not private.is_manager_at(decision.location_id) then
    raise exception 'Manager access required for this decision';
  end if;

  select version into current_version
  from app.rotation_state_versions
  where workday_id = decision.workday_id
  for update;

  if current_version <> expected_state_version then
    raise exception 'Rotation changed. Refresh and review the recommendation again.';
  end if;

  select result into replay_result
  from app.assignment_commands
    where location_id = decision.location_id
      and idempotency_key = command_idempotency_key;

  if replay_result is not null then
    return replay_result || jsonb_build_object('replayed', true);
  end if;

  if decision.status <> 'recommended' then
    raise exception 'This recommendation is no longer confirmable';
  end if;

  if not exists (
    select 1 from app.assignment_candidates
    where decision_id = decision.id
      and employee_id = selected_employee_id
      and outcome in ('recommended', 'eligible')
  ) then
    raise exception 'Selected employee is not an eligible candidate';
  end if;

  override_selected := selected_employee_id <> decision.recommended_employee_id;
  if override_selected and nullif(trim(override_reason), '') is null then
    raise exception 'An override reason is required';
  end if;

  insert into app.service_assignments (
    visit_id, visit_service_id, decision_id, location_id, employee_id,
    idempotency_key, is_override, override_reason, assigned_by
  )
  select decision.visit_id, visit_service.id, decision.id,
    decision.location_id, selected_employee_id, command_idempotency_key,
    override_selected, nullif(trim(override_reason), ''), (select auth.uid())
  from app.visit_services visit_service
  where visit_service.visit_id = decision.visit_id;

  select jsonb_agg(id) into assignment_ids
  from app.service_assignments
  where decision_id = decision.id;

  update app.assignment_decisions set status = 'confirmed'
  where id = decision.id;
  update app.customer_visits set status = 'assigned'
  where id = decision.visit_id;
  update app.visit_services set status = 'assigned'
  where visit_id = decision.visit_id;

  replay_result := jsonb_build_object(
    'visit_id', decision.visit_id,
    'assignment_ids', assignment_ids,
    'replayed', false
  );

  insert into app.assignment_commands (
    location_id, idempotency_key, decision_id, result, created_by
  ) values (
    decision.location_id, command_idempotency_key, decision.id,
    replay_result, (select auth.uid())
  );

  return replay_result;
end;
$$;

revoke all on function private.effective_qualification(uuid, uuid, timestamptz) from public;
revoke all on function app.create_visit_and_recommend(
  uuid, uuid[], app.visit_type, text, uuid, text
) from public;
revoke all on function app.confirm_assignment(uuid, uuid, bigint, uuid, text) from public;

grant execute on function app.create_visit_and_recommend(
  uuid, uuid[], app.visit_type, text, uuid, text
) to authenticated;
grant execute on function app.confirm_assignment(uuid, uuid, bigint, uuid, text)
  to authenticated;

alter publication supabase_realtime add table app.assignment_decisions;
alter publication supabase_realtime add table app.service_assignments;

comment on function app.create_visit_and_recommend(
  uuid, uuid[], app.visit_type, text, uuid, text
) is 'Creates an immutable visit and deterministic candidate snapshot.';
comment on function app.confirm_assignment(uuid, uuid, bigint, uuid, text)
  is 'Atomically confirms every service line using state-version and idempotency checks.';
