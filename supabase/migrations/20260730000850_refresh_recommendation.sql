create or replace function app.refresh_visit_recommendation(
  target_visit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_visit app.customer_visits%rowtype;
  selected_service_ids uuid[];
  refreshed_result jsonb;
  temporary_visit_id uuid;
  refreshed_decision_id uuid;
  refreshed_status app.assignment_decision_status;
begin
  select * into target_visit
  from app.customer_visits
  where id = target_visit_id
  for update;

  if target_visit.id is null
    or not private.is_manager_at(target_visit.location_id) then
    raise exception 'Manager access required for this visit';
  end if;

  if target_visit.status not in ('waiting', 'recommended') then
    raise exception 'Only an unassigned visit can be recommended again';
  end if;

  select array_agg(service_id order by sort_order)
  into selected_service_ids
  from app.visit_services
  where visit_id = target_visit.id;

  refreshed_result := app.create_visit_and_recommend(
    target_visit.workday_id,
    selected_service_ids,
    target_visit.visit_type,
    target_visit.customer_name_snapshot,
    target_visit.requested_employee_id,
    target_visit.notes
  );

  temporary_visit_id := (refreshed_result ->> 'visit_id')::uuid;
  refreshed_decision_id := (refreshed_result ->> 'decision_id')::uuid;

  update app.assignment_decisions
  set status = 'superseded'
  where visit_id = target_visit.id
    and status in ('recommended', 'no_candidate');

  update app.assignment_decisions
  set visit_id = target_visit.id
  where id = refreshed_decision_id
  returning status into refreshed_status;

  delete from app.customer_visits
  where id = temporary_visit_id;

  update app.customer_visits
  set status = case
    when refreshed_status = 'recommended'
      then 'recommended'::app.visit_status
    else 'waiting'::app.visit_status
  end
  where id = target_visit.id;

  return jsonb_build_object(
    'visit_id', target_visit.id,
    'decision_id', refreshed_decision_id,
    'recommended_employee_id',
      refreshed_result ->> 'recommended_employee_id',
    'expected_state_version',
      (refreshed_result ->> 'expected_state_version')::bigint
  );
end;
$$;

revoke all on function app.refresh_visit_recommendation(uuid) from public;
grant execute on function app.refresh_visit_recommendation(uuid) to authenticated;

comment on function app.refresh_visit_recommendation(uuid) is
  'Supersedes an unconfirmed snapshot and saves a new decision using current state.';
