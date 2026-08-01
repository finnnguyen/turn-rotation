drop policy assignments_select_for_members on app.service_assignments;
create policy assignments_select_manager_or_self
on app.service_assignments for select to authenticated
using (
  private.is_manager_at(location_id)
  or exists (
    select 1 from app.employees employee
    where employee.id = service_assignments.employee_id
      and employee.user_id = (select auth.uid())
  )
);

drop policy credit_events_select_for_members on app.turn_credit_events;
create policy credit_events_select_manager_or_self
on app.turn_credit_events for select to authenticated
using (
  private.is_manager_at(location_id)
  or exists (
    select 1 from app.employees employee
    where employee.id = turn_credit_events.employee_id
      and employee.user_id = (select auth.uid())
  )
);

drop policy completed_turns_select_for_members on app.completed_turns;
create policy completed_turns_select_manager_or_self
on app.completed_turns for select to authenticated
using (
  private.is_manager_at(location_id)
  or exists (
    select 1 from app.employees employee
    where employee.id = completed_turns.employee_id
      and employee.user_id = (select auth.uid())
  )
);

drop policy skips_select_for_members on app.skip_events;
create policy skips_select_manager_or_self
on app.skip_events for select to authenticated
using (
  private.is_manager_at(location_id)
  or exists (
    select 1 from app.employees employee
    where employee.id = skip_events.employee_id
      and employee.user_id = (select auth.uid())
  )
);

drop policy refusals_select_for_members on app.refusal_events;
create policy refusals_select_manager_or_self
on app.refusal_events for select to authenticated
using (
  private.is_manager_at(location_id)
  or exists (
    select 1 from app.employees employee
    where employee.id = refusal_events.employee_id
      and employee.user_id = (select auth.uid())
  )
);

create view app.daily_employee_summaries
with (security_invoker = true)
as
select
  workday.id as workday_id,
  workday.location_id,
  workday.business_date,
  employee.id as employee_id,
  employee.display_name,
  entry.master_position,
  entry.haircut_position,
  entry.dollar_balance,
  entry.haircut_balance,
  entry.current_status,
  (
    select count(distinct assignment.visit_id)
    from app.service_assignments assignment
    where assignment.employee_id = employee.id
      and assignment.visit_id in (
        select visit.id from app.customer_visits visit
        where visit.workday_id = workday.id
      )
      and assignment.status in ('started', 'completed')
  ) as customers_served,
  (
    select coalesce(sum(assignment.captured_listed_price), 0)
    from app.service_assignments assignment
    where assignment.employee_id = employee.id
      and assignment.visit_id in (
        select visit.id from app.customer_visits visit
        where visit.workday_id = workday.id
      )
      and assignment.status in ('started', 'completed')
  ) as listed_service_value,
  (
    select count(*) from app.service_assignments assignment
    where assignment.employee_id = employee.id
      and assignment.visit_id in (
        select visit.id from app.customer_visits visit
        where visit.workday_id = workday.id
      )
      and assignment.captured_turn_calculation = 'mens_haircut'
  ) as mens_haircuts,
  (
    select count(*) from app.service_assignments assignment
    where assignment.employee_id = employee.id
      and assignment.visit_id in (
        select visit.id from app.customer_visits visit
        where visit.workday_id = workday.id
      )
      and assignment.captured_turn_calculation = 'womens_haircut'
  ) as womens_haircuts,
  (
    select count(*) from app.completed_turns turn
    where turn.workday_id = workday.id and turn.employee_id = employee.id
      and turn.completion_type = 'master'
  ) as dollar_turns,
  (
    select count(*) from app.completed_turns turn
    where turn.workday_id = workday.id and turn.employee_id = employee.id
      and turn.completion_type = 'haircut'
  ) as haircut_turns,
  (
    select count(*) from app.skip_events skip
    where skip.workday_id = workday.id and skip.employee_id = employee.id
  ) as skips,
  (
    select count(*) from app.refusal_events refusal
    where refusal.workday_id = workday.id and refusal.employee_id = employee.id
  ) as refusals,
  (
    select count(*) from app.corrections correction
    where correction.workday_id = workday.id
      and correction.employee_id = employee.id
  ) as corrections,
  (
    select coalesce(sum(extract(epoch from (
      coalesce(status_event.ended_at, workday.closed_at, now())
      - status_event.started_at
    ))), 0)::bigint
    from app.employee_status_events status_event
    where status_event.workday_id = workday.id
      and status_event.employee_id = employee.id
      and status_event.status = 'available'
  ) as available_seconds,
  (
    select coalesce(sum(extract(epoch from (
      coalesce(status_event.ended_at, workday.closed_at, now())
      - status_event.started_at
    ))), 0)::bigint
    from app.employee_status_events status_event
    where status_event.workday_id = workday.id
      and status_event.employee_id = employee.id
      and status_event.status = 'busy'
  ) as busy_seconds,
  (
    select coalesce(sum(extract(epoch from (
      coalesce(status_event.ended_at, workday.closed_at, now())
      - status_event.started_at
    ))), 0)::bigint
    from app.employee_status_events status_event
    where status_event.workday_id = workday.id
      and status_event.employee_id = employee.id
      and status_event.status = 'break'
  ) as break_seconds
from app.workdays workday
join app.rotation_entries entry on entry.workday_id = workday.id
join app.employees employee on employee.id = entry.employee_id
where private.is_manager_at(workday.location_id)
  or employee.user_id = (select auth.uid());

create view app.daily_location_summaries
with (security_invoker = true)
as
select
  workday.id as workday_id,
  workday.location_id,
  workday.business_date,
  workday.status,
  (select count(*) from app.customer_visits visit
    where visit.workday_id = workday.id) as total_visits,
  (select count(*) from app.customer_visits visit
    where visit.workday_id = workday.id
      and visit.visit_type = 'walk_in') as walk_ins,
  (select count(*) from app.customer_visits visit
    where visit.workday_id = workday.id
      and visit.visit_type in ('requested_walk_in', 'requested_appointment'))
    as requested_visits,
  (select count(*) from app.customer_visits visit
    where visit.workday_id = workday.id
      and visit.visit_type in ('appointment', 'requested_appointment'))
    as appointments,
  (select count(*) from app.customer_visits visit
    where visit.workday_id = workday.id
      and visit.status = 'completed') as completed_visits,
  (select count(*) from app.customer_visits visit
    where visit.workday_id = workday.id
      and visit.status in ('waiting', 'recommended')) as waiting_visits,
  (select coalesce(sum(assignment.captured_listed_price), 0)
    from app.service_assignments assignment
    where assignment.visit_id in (
      select visit.id from app.customer_visits visit
      where visit.workday_id = workday.id
    ) and assignment.status in ('started', 'completed')) as listed_service_value,
  (select count(*) from app.completed_turns turn
    where turn.workday_id = workday.id) as completed_turns,
  (select count(*) from app.skip_events skip
    where skip.workday_id = workday.id) as skips,
  (select count(*) from app.refusal_events refusal
    where refusal.workday_id = workday.id) as refusals,
  (select count(*) from app.corrections correction
    where correction.workday_id = workday.id) as corrections,
  (select count(*) from app.service_assignments assignment
    where assignment.visit_id in (
      select visit.id from app.customer_visits visit
      where visit.workday_id = workday.id
    ) and assignment.is_override) as overrides
from app.workdays workday
where private.is_manager_at(workday.location_id);

grant select on app.daily_employee_summaries,
  app.daily_location_summaries to authenticated;

comment on view app.daily_employee_summaries is
  'Rebuildable employee fairness summary, manager-wide or staff-self only.';
comment on view app.daily_location_summaries is
  'Manager-only rebuildable daily salon operations summary.';
