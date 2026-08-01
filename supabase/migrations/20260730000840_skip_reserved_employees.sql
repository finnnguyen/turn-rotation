do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'app.create_visit_and_recommend(uuid,uuid[],app.visit_type,text,uuid,text)'::regprocedure
  )
  into function_definition;

  function_definition := replace(
    function_definition,
    $old$select entry.*, employee.display_name,
      status_event.expected_end_at$old$,
    $new$select entry.*, employee.display_name,
      status_event.expected_end_at,
      exists (
        select 1
        from app.assignment_reservations reservation
        where reservation.employee_id = entry.employee_id
          and reservation.location_id = entry.location_id
          and reservation.released_at is null
      ) as has_active_reservation$new$
  );

  function_definition := replace(
    function_definition,
    $old$candidate_skip := 'customer_requested_other_employee';
    elsif missing_qualification then$old$,
    $new$candidate_skip := 'customer_requested_other_employee';
    elsif candidate.has_active_reservation then
      candidate_outcome := 'skipped';
      candidate_skip := 'assigned_to_customer';
    elsif missing_qualification then$new$
  );

  execute function_definition;
end;
$migration$;

comment on function app.create_visit_and_recommend(
  uuid, uuid[], app.visit_type, text, uuid, text
) is 'Creates a deterministic snapshot and skips employees reserved by active assignments.';
