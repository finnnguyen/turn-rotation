-- Bug: closing a workday never released assignment_reservations or
-- finalized customer_visits still in a non-terminal status (waiting,
-- recommended, assigned, in_service). assignment_reservations is scoped by
-- (location_id, employee_id), not workday_id, so a reservation left over
-- from an unresolved visit on a closed day silently blocked that employee
-- from every future recommendation ("has_active_reservation" skip),
-- indefinitely, on any later day. Unresolved visits also stayed stuck in a
-- non-terminal status forever, tied to a workday that no longer exists as
-- "open" — dangling state with no way to reach a terminal one.
-- Found via manual production testing: real reservations from prior closed
-- days were still active, silently skipping real employees.
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

  -- Release any reservation still held by an unresolved visit on this
  -- workday, so the employee isn't skipped as "still with a customer" on
  -- every future day.
  update app.assignment_reservations
  set released_at = now(), release_reason = 'Workday closed'
  where released_at is null
    and visit_id in (
      select id from app.customer_visits where workday_id = target_workday_id
    );

  -- Any visit that never reached a terminal status (completed/cancelled/
  -- no_show) by close is cancelled rather than left dangling indefinitely.
  update app.visit_services
  set status = 'cancelled'
  where visit_id in (
    select id from app.customer_visits
    where workday_id = target_workday_id
      and status not in ('completed', 'cancelled', 'no_show')
  );

  update app.customer_visits
  set status = 'cancelled',
      notes = trim(both from concat_ws(' ', notes, '[Auto-cancelled: workday closed while unresolved]'))
  where workday_id = target_workday_id
    and status not in ('completed', 'cancelled', 'no_show');

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
