do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'app.create_visit_and_recommend(uuid,uuid[],app.visit_type,text,uuid,text)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    $old$elsif candidate.has_active_reservation then
      candidate_outcome := 'skipped';
      candidate_skip := 'assigned_to_customer';
    elsif missing_qualification then$old$,
    $new$elsif candidate.has_active_reservation then
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
    elsif missing_qualification then$new$
  );

  execute function_definition;

  select pg_get_functiondef(
    'app.refresh_visit_recommendation(uuid)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    $old$refreshed_result := app.create_visit_and_recommend($old$,
    $new$perform set_config(
    'app.refresh_source_visit_id',
    target_visit.id::text,
    true
  );

  refreshed_result := app.create_visit_and_recommend($new$
  );

  function_definition := replace(
    function_definition,
    $old$temporary_visit_id := (refreshed_result ->> 'visit_id')::uuid;$old$,
    $new$perform set_config('app.refresh_source_visit_id', '', true);

  temporary_visit_id := (refreshed_result ->> 'visit_id')::uuid;$new$
  );

  execute function_definition;
end;
$migration$;

comment on function app.create_visit_and_recommend(
  uuid, uuid[], app.visit_type, text, uuid, text
) is 'Deterministic recommendation honoring busy mode, reservations, and visit-specific no-repeat skips.';
