create type app.credit_type as enum (
  'dollar_partial',
  'mens_haircut',
  'womens_haircut',
  'full_turn',
  'reset',
  'expiration',
  'reversal',
  'correction'
);

alter table app.service_assignments
  add column captured_price_version_id uuid references app.service_price_versions(id),
  add column captured_listed_price numeric(10, 2),
  add column captured_turn_calculation app.turn_calculation_type,
  add column captured_duration_minutes integer,
  add constraint started_assignment_has_snapshot check (
    status = 'assigned'
    or (
      captured_price_version_id is not null
      and captured_listed_price is not null
      and captured_turn_calculation is not null
    )
  );

create table app.turn_credit_events (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  visit_id uuid,
  assignment_id uuid references app.service_assignments(id),
  credit_type app.credit_type not null,
  dollar_amount numeric(10, 2) not null default 0,
  haircut_amount numeric(8, 6) not null default 0,
  dollar_balance_before numeric(10, 2) not null default 0,
  dollar_balance_after numeric(10, 2) not null default 0,
  haircut_balance_before numeric(8, 6) not null default 0,
  haircut_balance_after numeric(8, 6) not null default 0,
  state_version bigint not null,
  explanation text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid not null references app.user_profiles(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id),
  check (dollar_amount >= 0),
  check (haircut_amount >= 0),
  check (dollar_balance_before >= 0 and dollar_balance_after >= 0),
  check (haircut_balance_before >= 0 and haircut_balance_after >= 0)
);

create table app.completed_turns (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  visit_id uuid not null,
  completion_type app.rotation_type not null,
  qualifying_amount numeric(10, 6) not null,
  threshold_amount numeric(10, 6) not null,
  state_version bigint not null,
  completed_at timestamptz not null default now(),
  actor_id uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (visit_id, employee_id, completion_type),
  foreign key (workday_id, location_id)
    references app.workdays(id, location_id),
  foreign key (employee_id, location_id)
    references app.employees(id, location_id),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id)
);

create table app.service_commands (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  idempotency_key uuid not null,
  visit_id uuid not null,
  command_type text not null check (command_type in ('start', 'complete')),
  result jsonb not null,
  created_by uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (location_id, idempotency_key),
  foreign key (visit_id, location_id)
    references app.customer_visits(id, location_id)
);

alter table app.turn_credit_events enable row level security;
alter table app.completed_turns enable row level security;
alter table app.service_commands enable row level security;

create policy credit_events_select_for_members
on app.turn_credit_events for select to authenticated
using (private.user_has_location(location_id));
create policy completed_turns_select_for_members
on app.completed_turns for select to authenticated
using (private.user_has_location(location_id));
create policy service_commands_select_for_members
on app.service_commands for select to authenticated
using (private.user_has_location(location_id));

grant select on app.turn_credit_events, app.completed_turns,
  app.service_commands to authenticated;

create or replace function private.move_master_to_end(
  target_workday_id uuid,
  target_employee_id uuid,
  target_state_version bigint
)
returns table(position_before integer, position_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_position integer;
  final_position integer;
begin
  select master_position into old_position
  from app.rotation_entries
  where workday_id = target_workday_id and employee_id = target_employee_id
  for update;

  if old_position is null then
    raise exception 'Employee is not active in the master rotation';
  end if;

  select count(*)::integer into final_position
  from app.rotation_entries
  where workday_id = target_workday_id and master_position is not null;

  update app.rotation_entries
  set master_position = null, state_version = target_state_version
  where workday_id = target_workday_id and employee_id = target_employee_id;

  update app.rotation_entries
  set master_position = master_position - 1,
      state_version = target_state_version
  where workday_id = target_workday_id
    and master_position > old_position;

  update app.rotation_entries
  set master_position = final_position, state_version = target_state_version
  where workday_id = target_workday_id and employee_id = target_employee_id;

  return query select old_position, final_position;
end;
$$;

create or replace function private.move_haircut_to_end(
  target_workday_id uuid,
  target_employee_id uuid,
  target_state_version bigint
)
returns table(position_before integer, position_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_position integer;
  final_position integer;
begin
  select haircut_position into old_position
  from app.rotation_entries
  where workday_id = target_workday_id and employee_id = target_employee_id
  for update;

  if old_position is null then
    raise exception 'Employee is not active in the haircut rotation';
  end if;

  select count(*)::integer into final_position
  from app.rotation_entries
  where workday_id = target_workday_id and haircut_position is not null;

  update app.rotation_entries
  set haircut_position = null, state_version = target_state_version
  where workday_id = target_workday_id and employee_id = target_employee_id;

  update app.rotation_entries
  set haircut_position = haircut_position - 1,
      state_version = target_state_version
  where workday_id = target_workday_id
    and haircut_position > old_position;

  update app.rotation_entries
  set haircut_position = final_position, state_version = target_state_version
  where workday_id = target_workday_id and employee_id = target_employee_id;

  return query select old_position, final_position;
end;
$$;

create or replace function app.start_visit_services(
  target_visit_id uuid,
  expected_state_version bigint,
  command_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_visit app.customer_visits%rowtype;
  target_rule app.rule_set_versions%rowtype;
  current_version bigint;
  next_version bigint;
  replay_result jsonb;
  employee_record record;
  assignment_record record;
  master_move record;
  haircut_move record;
  dollar_before numeric(10, 2);
  haircut_before numeric(8, 6);
  dollar_total numeric(10, 2);
  haircut_total numeric(8, 6);
  dollar_after numeric(10, 2);
  haircut_after numeric(8, 6);
  duration_total integer;
  dollar_turn_completed boolean;
  haircut_turn_completed boolean;
  credit_fraction numeric(8, 6);
begin
  select * into target_visit
  from app.customer_visits
  where id = target_visit_id
  for update;

  if target_visit.id is null
    or not private.is_manager_at(target_visit.location_id) then
    raise exception 'Manager access required for this visit';
  end if;

  select result into replay_result
  from app.service_commands
  where location_id = target_visit.location_id
    and idempotency_key = command_idempotency_key;
  if replay_result is not null then
    return replay_result || jsonb_build_object('replayed', true);
  end if;

  if target_visit.status <> 'assigned' then
    raise exception 'Only an assigned visit can start service';
  end if;

  select version into current_version
  from app.rotation_state_versions
  where workday_id = target_visit.workday_id
  for update;
  if current_version <> expected_state_version then
    raise exception 'Rotation changed. Refresh before starting service.';
  end if;

  select rules.* into target_rule
  from app.workdays workday
  join app.rule_set_versions rules on rules.id = workday.rule_set_version_id
  where workday.id = target_visit.workday_id and workday.status = 'open';
  if target_rule.id is null then
    raise exception 'The workday is not open';
  end if;

  next_version := private.lock_and_increment_rotation(target_visit.workday_id);

  for employee_record in
    select distinct employee_id
    from app.service_assignments
    where visit_id = target_visit.id and status = 'assigned'
  loop
    select dollar_balance, haircut_balance
    into dollar_before, haircut_before
    from app.rotation_entries
    where workday_id = target_visit.workday_id
      and employee_id = employee_record.employee_id
    for update;

    if dollar_before is null then
      raise exception 'Assigned employee is not clocked in';
    end if;

    dollar_total := 0;
    haircut_total := 0;
    duration_total := 0;

    for assignment_record in
      select assignment.id as assignment_id, service.id as service_id,
        service.name, service.turn_calculation,
        service.typical_duration_minutes,
        price.id as price_version_id, price.listed_price
      from app.service_assignments assignment
      join app.visit_services visit_service
        on visit_service.id = assignment.visit_service_id
      join app.services service on service.id = visit_service.service_id
      join lateral (
        select version.id, version.listed_price
        from app.service_price_versions version
        where version.service_id = service.id
          and version.effective_from <= now()
          and (version.effective_until is null or version.effective_until > now())
        order by version.effective_from desc limit 1
      ) price on true
      where assignment.visit_id = target_visit.id
        and assignment.employee_id = employee_record.employee_id
        and assignment.status = 'assigned'
      order by assignment.assigned_at, assignment.id
    loop
      update app.service_assignments
      set status = 'started',
          captured_price_version_id = assignment_record.price_version_id,
          captured_listed_price = assignment_record.listed_price,
          captured_turn_calculation = assignment_record.turn_calculation,
          captured_duration_minutes = assignment_record.typical_duration_minutes,
          started_at = now()
      where id = assignment_record.assignment_id;

      duration_total := duration_total
        + coalesce(assignment_record.typical_duration_minutes, 0);

      if assignment_record.turn_calculation = 'dollar' then
        dollar_total := dollar_total + assignment_record.listed_price;
        insert into app.turn_credit_events (
          workday_id, location_id, employee_id, visit_id, assignment_id,
          credit_type, dollar_amount, dollar_balance_before,
          dollar_balance_after, haircut_balance_before,
          haircut_balance_after, state_version, explanation, details, actor_id
        ) values (
          target_visit.workday_id, target_visit.location_id,
          employee_record.employee_id, target_visit.id,
          assignment_record.assignment_id, 'dollar_partial',
          assignment_record.listed_price, dollar_before,
          dollar_before + dollar_total, haircut_before, haircut_before,
          next_version, format(
            '%s contributed $%s toward the $%s turn threshold',
            assignment_record.name, assignment_record.listed_price,
            target_rule.dollar_threshold
          ), jsonb_build_object(
            'price_version_id', assignment_record.price_version_id,
            'service_id', assignment_record.service_id
          ), (select auth.uid())
        );
      elsif assignment_record.turn_calculation in (
        'mens_haircut', 'womens_haircut'
      ) then
        credit_fraction := case
          when assignment_record.turn_calculation = 'mens_haircut'
            then target_rule.mens_haircut_fraction
          else target_rule.womens_haircut_fraction
        end;
        haircut_total := haircut_total + credit_fraction;

        select * into haircut_move
        from private.move_haircut_to_end(
          target_visit.workday_id,
          employee_record.employee_id,
          next_version
        );

        insert into app.rotation_events (
          workday_id, location_id, employee_id, rotation_type, event_type,
          position_before, position_after, state_version, explanation,
          details, actor_id
        ) values (
          target_visit.workday_id, target_visit.location_id,
          employee_record.employee_id, 'haircut', 'haircut_advanced',
          haircut_move.position_before, haircut_move.position_after,
          next_version, 'Started a haircut and advanced to the end of the shared haircut rotation',
          jsonb_build_object('visit_id', target_visit.id, 'service_id', assignment_record.service_id),
          (select auth.uid())
        );

        insert into app.turn_credit_events (
          workday_id, location_id, employee_id, visit_id, assignment_id,
          credit_type, haircut_amount, dollar_balance_before,
          dollar_balance_after, haircut_balance_before,
          haircut_balance_after, state_version, explanation, details, actor_id
        ) values (
          target_visit.workday_id, target_visit.location_id,
          employee_record.employee_id, target_visit.id,
          assignment_record.assignment_id,
          case when assignment_record.turn_calculation = 'mens_haircut'
            then 'mens_haircut'::app.credit_type
            else 'womens_haircut'::app.credit_type end,
          credit_fraction, dollar_before, dollar_before,
          haircut_before, haircut_before + haircut_total,
          next_version, format('%s added %s haircut-turn credit',
            assignment_record.name, credit_fraction),
          jsonb_build_object('service_id', assignment_record.service_id),
          (select auth.uid())
        );
      end if;
    end loop;

    dollar_turn_completed := dollar_before + dollar_total
      >= target_rule.dollar_threshold;
    haircut_turn_completed := haircut_before + haircut_total >= 1;
    dollar_after := case when dollar_turn_completed
      then 0 else dollar_before + dollar_total end;
    haircut_after := case when haircut_turn_completed
      then 0 else haircut_before + haircut_total end;

    update app.rotation_entries
    set dollar_balance = dollar_after,
        haircut_balance = haircut_after,
        current_status = 'busy',
        state_version = next_version
    where workday_id = target_visit.workday_id
      and employee_id = employee_record.employee_id;

    if dollar_turn_completed then
      select * into master_move
      from private.move_master_to_end(
        target_visit.workday_id, employee_record.employee_id, next_version
      );
      insert into app.completed_turns (
        workday_id, location_id, employee_id, visit_id, completion_type,
        qualifying_amount, threshold_amount, state_version, actor_id
      ) values (
        target_visit.workday_id, target_visit.location_id,
        employee_record.employee_id, target_visit.id, 'master',
        dollar_before + dollar_total, target_rule.dollar_threshold,
        next_version, (select auth.uid())
      );
      insert into app.rotation_events (
        workday_id, location_id, employee_id, rotation_type, event_type,
        position_before, position_after, state_version, explanation,
        details, actor_id
      ) values (
        target_visit.workday_id, target_visit.location_id,
        employee_record.employee_id, 'master', 'full_turn_completed',
        master_move.position_before, master_move.position_after, next_version,
        'Dollar credit reached the threshold; excess was discarded and the employee moved to the end',
        jsonb_build_object(
          'visit_id', target_visit.id,
          'qualifying_amount', dollar_before + dollar_total,
          'threshold', target_rule.dollar_threshold
        ), (select auth.uid())
      );
    end if;

    if haircut_turn_completed then
      select * into master_move
      from private.move_master_to_end(
        target_visit.workday_id, employee_record.employee_id, next_version
      );
      insert into app.completed_turns (
        workday_id, location_id, employee_id, visit_id, completion_type,
        qualifying_amount, threshold_amount, state_version, actor_id
      ) values (
        target_visit.workday_id, target_visit.location_id,
        employee_record.employee_id, target_visit.id, 'haircut',
        haircut_before + haircut_total, 1, next_version, (select auth.uid())
      );
      insert into app.rotation_events (
        workday_id, location_id, employee_id, rotation_type, event_type,
        position_before, position_after, state_version, explanation,
        details, actor_id
      ) values (
        target_visit.workday_id, target_visit.location_id,
        employee_record.employee_id, 'master', 'full_turn_completed',
        master_move.position_before, master_move.position_after, next_version,
        'Haircut credit completed a full turn; excess was discarded and the employee moved to the master end',
        jsonb_build_object(
          'visit_id', target_visit.id,
          'qualifying_amount', haircut_before + haircut_total
        ), (select auth.uid())
      );
    end if;

    update app.employee_status_events set ended_at = now()
    where workday_id = target_visit.workday_id
      and employee_id = employee_record.employee_id and ended_at is null;
    insert into app.employee_status_events (
      workday_id, location_id, employee_id, status, expected_end_at,
      reason, actor_id
    ) values (
      target_visit.workday_id, target_visit.location_id,
      employee_record.employee_id, 'busy',
      now() + make_interval(mins => duration_total),
      format('Serving ticket %s', target_visit.ticket_number),
      (select auth.uid())
    );
  end loop;

  update app.customer_visits set status = 'in_service'
  where id = target_visit.id;
  update app.visit_services set status = 'in_service'
  where visit_id = target_visit.id;

  replay_result := jsonb_build_object(
    'visit_id', target_visit.id,
    'state_version', next_version,
    'replayed', false
  );
  insert into app.service_commands (
    location_id, idempotency_key, visit_id, command_type, result, created_by
  ) values (
    target_visit.location_id, command_idempotency_key, target_visit.id,
    'start', replay_result, (select auth.uid())
  );
  return replay_result;
end;
$$;

create or replace function app.complete_visit_services(
  target_visit_id uuid,
  expected_state_version bigint,
  command_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_visit app.customer_visits%rowtype;
  current_version bigint;
  next_version bigint;
  replay_result jsonb;
  employee_record record;
begin
  select * into target_visit
  from app.customer_visits where id = target_visit_id for update;

  if target_visit.id is null
    or not private.is_manager_at(target_visit.location_id) then
    raise exception 'Manager access required for this visit';
  end if;

  select result into replay_result from app.service_commands
  where location_id = target_visit.location_id
    and idempotency_key = command_idempotency_key;
  if replay_result is not null then
    return replay_result || jsonb_build_object('replayed', true);
  end if;

  if target_visit.status <> 'in_service' then
    raise exception 'Only an in-service visit can be completed';
  end if;

  select version into current_version
  from app.rotation_state_versions
  where workday_id = target_visit.workday_id for update;
  if current_version <> expected_state_version then
    raise exception 'Rotation changed. Refresh before completing service.';
  end if;

  next_version := private.lock_and_increment_rotation(target_visit.workday_id);

  for employee_record in
    select distinct employee_id from app.service_assignments
    where visit_id = target_visit.id and status = 'started'
  loop
    update app.employee_status_events set ended_at = now()
    where workday_id = target_visit.workday_id
      and employee_id = employee_record.employee_id and ended_at is null;
    insert into app.employee_status_events (
      workday_id, location_id, employee_id, status, reason, actor_id
    ) values (
      target_visit.workday_id, target_visit.location_id,
      employee_record.employee_id, 'available',
      format('Completed ticket %s', target_visit.ticket_number),
      (select auth.uid())
    );
    update app.rotation_entries
    set current_status = 'available', state_version = next_version
    where workday_id = target_visit.workday_id
      and employee_id = employee_record.employee_id;
  end loop;

  update app.service_assignments
  set status = 'completed', completed_at = now()
  where visit_id = target_visit.id and status = 'started';
  update app.visit_services set status = 'completed'
  where visit_id = target_visit.id;
  update app.customer_visits set status = 'completed'
  where id = target_visit.id;
  update app.assignment_reservations
  set released_at = now(), release_reason = 'Service completed'
  where visit_id = target_visit.id and released_at is null;

  replay_result := jsonb_build_object(
    'visit_id', target_visit.id,
    'state_version', next_version,
    'replayed', false
  );
  insert into app.service_commands (
    location_id, idempotency_key, visit_id, command_type, result, created_by
  ) values (
    target_visit.location_id, command_idempotency_key, target_visit.id,
    'complete', replay_result, (select auth.uid())
  );
  return replay_result;
end;
$$;

create or replace function private.record_balance_expiration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_status = 'finished' and old.current_status <> 'finished' then
    if old.dollar_balance > 0 then
      insert into app.turn_credit_events (
        workday_id, location_id, employee_id, credit_type, dollar_amount,
        dollar_balance_before, dollar_balance_after, haircut_balance_before,
        haircut_balance_after, state_version, explanation, actor_id
      ) values (
        old.workday_id, old.location_id, old.employee_id, 'expiration',
        old.dollar_balance, old.dollar_balance, 0, old.haircut_balance,
        old.haircut_balance, new.state_version,
        'Unfinished dollar credit expired at end of day', (select auth.uid())
      );
    end if;
    if old.haircut_balance > 0 then
      insert into app.turn_credit_events (
        workday_id, location_id, employee_id, credit_type, haircut_amount,
        dollar_balance_before, dollar_balance_after, haircut_balance_before,
        haircut_balance_after, state_version, explanation, actor_id
      ) values (
        old.workday_id, old.location_id, old.employee_id, 'expiration',
        old.haircut_balance, old.dollar_balance, old.dollar_balance,
        old.haircut_balance, 0, new.state_version,
        'Unfinished haircut credit expired at end of day', (select auth.uid())
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger rotation_entries_record_expiration
before update on app.rotation_entries
for each row execute function private.record_balance_expiration();

revoke all on function private.move_master_to_end(uuid, uuid, bigint) from public;
revoke all on function private.move_haircut_to_end(uuid, uuid, bigint) from public;
revoke all on function private.record_balance_expiration() from public;
revoke all on function app.start_visit_services(uuid, bigint, uuid) from public;
revoke all on function app.complete_visit_services(uuid, bigint, uuid) from public;

grant execute on function app.start_visit_services(uuid, bigint, uuid)
  to authenticated;
grant execute on function app.complete_visit_services(uuid, bigint, uuid)
  to authenticated;

alter publication supabase_realtime add table app.turn_credit_events;
alter publication supabase_realtime add table app.completed_turns;

comment on table app.turn_credit_events is
  'Append-only dollar, haircut, full-turn, and expiration accounting ledger.';
comment on table app.completed_turns is
  'One durable completed-turn record per visit, employee, and rotation type.';
