do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'app.apply_balance_correction(uuid,uuid,numeric,numeric,text,boolean)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    E'  move_record record;\n',
    ''
  );
  function_definition := replace(
    function_definition,
    'select * into move_record from private.move_master_to_end(',
    'perform private.move_master_to_end('
  );

  execute function_definition;
end;
$migration$;
