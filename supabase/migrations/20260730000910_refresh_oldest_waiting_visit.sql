create or replace function private.refresh_oldest_waiting_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  waiting_visit_id uuid;
begin
  if old.released_at is null and new.released_at is not null then
    select visit.id
    into waiting_visit_id
    from app.customer_visits visit
    where visit.workday_id = (
        select source_visit.workday_id
        from app.customer_visits source_visit
        where source_visit.id = new.visit_id
      )
      and visit.status = 'waiting'
      and exists (
        select 1
        from app.assignment_decisions decision
        where decision.visit_id = visit.id
          and decision.status = 'no_candidate'
          and decision.created_at = (
            select max(latest.created_at)
            from app.assignment_decisions latest
            where latest.visit_id = visit.id
          )
      )
    order by visit.arrived_at, visit.ticket_number
    limit 1
    for update of visit skip locked;

    if waiting_visit_id is not null then
      perform app.refresh_visit_recommendation(waiting_visit_id);
    end if;
  end if;

  return new;
end;
$$;

create trigger assignment_release_refreshes_waiting_visit
after update of released_at on app.assignment_reservations
for each row execute function private.refresh_oldest_waiting_visit();

revoke all on function private.refresh_oldest_waiting_visit() from public;

comment on function private.refresh_oldest_waiting_visit() is
  'Recommends the oldest no-candidate visit when a service completion releases an employee.';
