-- Edge Functions use the service role after independently validating the
-- caller. Custom schemas still require explicit SQL privileges even though
-- service_role bypasses row-level security.
grant usage on schema app to service_role;

grant select, insert, update on app.service_menu_imports to service_role;
grant select, insert, update on app.service_menu_lines to service_role;
grant select, insert, update on app.service_import_drafts to service_role;

comment on table app.service_menu_imports is
  'Private Amazon Textract jobs. Managers use RLS; the authenticated Edge Function uses narrowly granted service-role access.';
