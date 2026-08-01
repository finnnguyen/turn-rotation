do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'app.create_visit_and_recommend(uuid,uuid[],app.visit_type,text,uuid,text)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    $old$busy_only_found boolean;
  weakest_qualification$old$,
    $new$busy_only_found boolean;
  busy_mode_active boolean;
  weakest_qualification$new$
  );

  function_definition := replace(
    function_definition,
    $old$select version into current_version
  from app.rotation_state_versions
  where workday_id = target_workday_id;$old$,
    $new$select version into current_version
  from app.rotation_state_versions
  where workday_id = target_workday_id;

  select exists (
    select 1 from app.busy_mode_periods
    where workday_id = target_workday_id and ended_at is null
  ) into busy_mode_active;$new$
  );

  function_definition := replace(
    function_definition,
    $old$'busy_only_active', false$old$,
    $new$'busy_only_active', busy_mode_active$new$
  );

  function_definition := replace(
    function_definition,
    $old$elsif busy_only_found then$old$,
    $new$elsif busy_only_found and not busy_mode_active then$new$
  );

  execute function_definition;
end;
$migration$;

comment on function app.create_visit_and_recommend(
  uuid, uuid[], app.visit_type, text, uuid, text
) is 'Deterministic recommendation including busy-only qualifications only during active busy mode.';
