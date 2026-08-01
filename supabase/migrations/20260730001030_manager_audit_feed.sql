create view app.manager_audit_feed
with (security_invoker = true)
as
select
  id,
  location_id,
  workday_id,
  actor_id,
  employee_id,
  visit_id,
  event_type,
  entity_type,
  entity_id,
  summary,
  details,
  occurred_at,
  created_at
from audit.audit_events;

grant select on app.manager_audit_feed to authenticated;

comment on view app.manager_audit_feed is
  'RLS-protected read-only audit feed without exposing the audit schema through PostgREST.';
