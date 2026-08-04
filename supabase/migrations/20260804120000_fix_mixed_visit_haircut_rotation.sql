-- Bug: a visit that mixed a haircut with any non-haircut (dollar) service was
-- treated as a pure "master" rotation visit for recommendation purposes,
-- because selected_rotation required requested_count = haircut_count (every
-- selected service must be a haircut). That silently dropped the haircut
-- queue out of consideration for any mixed visit, so the actual next-in-line
-- haircut candidate could be skipped in favor of whoever was next in the
-- master (dollar) queue — violating the "every haircut advances the shared
-- haircut rotation" guarantee for exactly the visits where it mattered most.
-- Fix: any visit containing at least one haircut service must still respect
-- haircut queue ordering, not just visits that are haircut-only.
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
  busy_mode_active boolean;
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

  select exists (
    select 1 from app.busy_mode_periods
    where workday_id = target_workday_id and ended_at is null
  ) into busy_mode_active;

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

  -- Fixed: any visit containing a haircut must respect the haircut queue,
  -- not only visits made up entirely of haircuts.
  selected_rotation := case
    when haircut_count > 0 then 'haircut'::app.rotation_type
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
      'busy_only_active', busy_mode_active
    ),
    (select auth.uid())
  ) returning id into created_decision_id;

  for candidate in
    select entry.*, employee.display_name,
      status_event.expected_end_at,
      exists (
        select 1
        from app.assignment_reservations reservation
        where reservation.employee_id = entry.employee_id
          and reservation.location_id = entry.location_id
          and reservation.released_at is null
      ) as has_active_reservation
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
    elsif candidate.has_active_reservation then
      candidate_outcome := 'skipped';
      candidate_skip := 'assigned_to_customer';
    elsif exists (
      select 1 from app.skip_events skip
      where skip.visit_id = coalesce(
          nullif(current_setting('app.refresh_source_visit_id', true), '')::uuid,
          created_visit_id
        )
        and skip.employee_id = candidate.employee_id
        and skip.skip_type in (
          'employee_refusal', 'approved_restriction', 'customer_declined'
        )
    ) then
      candidate_outcome := 'skipped';
      select case skip.skip_type
        when 'employee_refusal' then 'employee_refusal'::app.assignment_skip_reason
        when 'approved_restriction' then 'approved_restriction'::app.assignment_skip_reason
        else 'customer_declined'::app.assignment_skip_reason
      end
      into candidate_skip
      from app.skip_events skip
      where skip.visit_id = coalesce(
          nullif(current_setting('app.refresh_source_visit_id', true), '')::uuid,
          created_visit_id
        )
        and skip.employee_id = candidate.employee_id
      order by skip.occurred_at desc
      limit 1;
    elsif missing_qualification then
      candidate_outcome := 'skipped';
      candidate_skip := 'unqualified';
    elsif busy_only_found and not busy_mode_active then
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
