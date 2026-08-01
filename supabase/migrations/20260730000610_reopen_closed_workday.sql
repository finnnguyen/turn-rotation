create or replace function app.open_workday(
  target_location_id uuid,
  target_business_date date default null,
  workday_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_workday_id uuid;
  existing_workday_id uuid;
  active_rule_id uuid;
  location_timezone text;
  resolved_date date;
begin
  if not private.is_manager_at(target_location_id) then
    raise exception 'Manager access required to open a workday';
  end if;

  select timezone into location_timezone
  from app.salon_locations
  where id = target_location_id and active
  for update;

  if location_timezone is null then
    raise exception 'Active salon location not found';
  end if;

  resolved_date := coalesce(
    target_business_date,
    (now() at time zone location_timezone)::date
  );

  select id into active_rule_id
  from app.rule_set_versions
  where location_id = target_location_id
    and effective_from <= now()
    and (effective_until is null or effective_until > now())
  order by effective_from desc
  limit 1;

  if active_rule_id is null then
    raise exception 'No active rule set exists for this location';
  end if;

  select id into existing_workday_id
  from app.workdays
  where location_id = target_location_id
    and business_date = resolved_date
  for update;

  if existing_workday_id is not null then
    if exists (
      select 1 from app.workdays
      where id = existing_workday_id and status <> 'closed'
    ) then
      return existing_workday_id;
    end if;

    update app.workdays
    set status = 'open',
        rule_set_version_id = active_rule_id,
        closed_at = null,
        closed_by = null,
        notes = coalesce(nullif(trim(workday_notes), ''), notes)
    where id = existing_workday_id;

    return existing_workday_id;
  end if;

  insert into app.workdays (
    location_id,
    business_date,
    status,
    rule_set_version_id,
    opened_by,
    notes
  )
  values (
    target_location_id,
    resolved_date,
    'open',
    active_rule_id,
    (select auth.uid()),
    nullif(trim(workday_notes), '')
  )
  returning id into created_workday_id;

  insert into app.rotation_state_versions (workday_id, location_id)
  values (created_workday_id, target_location_id);

  return created_workday_id;
end;
$$;

revoke all on function app.open_workday(uuid, date, text) from public;
grant execute on function app.open_workday(uuid, date, text) to authenticated;

comment on function app.open_workday(uuid, date, text) is
  'Opens a new business date or safely reopens its existing closed workday.';
