create table app.assignment_reservations (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  decision_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text,
  created_by uuid not null references app.user_profiles(id),
  unique (visit_id),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id),
  foreign key (decision_id, location_id)
    references app.assignment_decisions(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  check (released_at is null or released_at >= reserved_at)
);

create unique index assignment_reservations_one_active_per_employee
  on app.assignment_reservations (location_id, employee_id)
  where released_at is null;

alter table app.assignment_reservations enable row level security;

create policy assignment_reservations_select_for_members
on app.assignment_reservations for select to authenticated
using (private.user_has_location(location_id));

grant select on app.assignment_reservations to authenticated;

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

  select result into replay_result
  from app.assignment_commands
  where location_id = decision.location_id
    and idempotency_key = command_idempotency_key;

  if replay_result is not null then
    return replay_result || jsonb_build_object('replayed', true);
  end if;

  select version into current_version
  from app.rotation_state_versions
  where workday_id = decision.workday_id
  for update;

  if current_version <> expected_state_version then
    raise exception 'Rotation changed. Refresh and review the recommendation again.';
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

  begin
    insert into app.assignment_reservations (
      visit_id, decision_id, location_id, employee_id, created_by
    ) values (
      decision.visit_id, decision.id, decision.location_id,
      selected_employee_id, (select auth.uid())
    );
  exception
    when unique_violation then
      raise exception
        'This employee was assigned on another device. Refresh and recommend again.';
  end;

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

revoke all on function app.confirm_assignment(uuid, uuid, bigint, uuid, text)
  from public;
grant execute on function app.confirm_assignment(uuid, uuid, bigint, uuid, text)
  to authenticated;

comment on table app.assignment_reservations is
  'Prevents two active visits from reserving the same employee concurrently.';
