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
    $old$set status = case when chosen_employee_id is null
      then 'no_candidate' else 'recommended' end,$old$,
    $new$set status = (case when chosen_employee_id is null
      then 'no_candidate' else 'recommended' end)::app.assignment_decision_status,$new$
  );

  function_definition := replace(
    function_definition,
    $old$set status = case when chosen_employee_id is null
    then 'waiting' else 'recommended' end$old$,
    $new$set status = (case when chosen_employee_id is null
    then 'waiting' else 'recommended' end)::app.visit_status$new$
  );

  execute function_definition;
end;
$migration$;

comment on function app.create_visit_and_recommend(
  uuid, uuid[], app.visit_type, text, uuid, text
) is 'Creates an immutable visit and deterministic, enum-safe candidate snapshot.';
