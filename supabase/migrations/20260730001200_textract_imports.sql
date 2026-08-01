create type app.menu_import_status as enum (
  'uploaded', 'processing', 'ready_for_review', 'failed', 'confirmed'
);

create table app.service_menu_imports (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references app.salon_locations(id),
  source_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png')),
  status app.menu_import_status not null default 'uploaded',
  provider text not null default 'amazon_textract',
  request_key uuid not null default gen_random_uuid(),
  raw_response jsonb,
  error_message text,
  created_by uuid not null references app.user_profiles(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (location_id, request_key)
);

create table app.service_menu_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references app.service_menu_imports(id) on delete cascade,
  location_id uuid not null references app.salon_locations(id),
  line_index integer not null,
  text text not null,
  confidence numeric(5, 2) not null check (confidence between 0 and 100),
  bounding_box jsonb,
  created_at timestamptz not null default now(),
  unique (import_id, line_index)
);

create table app.service_import_drafts (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references app.service_menu_imports(id) on delete cascade,
  location_id uuid not null references app.salon_locations(id),
  source_line_id uuid references app.service_menu_lines(id),
  proposed_name text not null,
  proposed_price numeric(10, 2) check (proposed_price >= 0),
  confidence numeric(5, 2) not null check (confidence between 0 and 100),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'dismissed')),
  confirmed_service_id uuid references app.services(id),
  reviewed_by uuid references app.user_profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table app.service_menu_imports enable row level security;
alter table app.service_menu_lines enable row level security;
alter table app.service_import_drafts enable row level security;

create policy menu_imports_manager_only on app.service_menu_imports
for all to authenticated using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));
create policy menu_lines_manager_only on app.service_menu_lines
for all to authenticated using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));
create policy import_drafts_manager_only on app.service_import_drafts
for all to authenticated using (private.is_manager_at(location_id))
with check (private.is_manager_at(location_id));

grant select, insert, update on app.service_menu_imports to authenticated;
grant select, insert, update on app.service_menu_lines to authenticated;
grant select, insert, update on app.service_import_drafts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-menu-imports', 'service-menu-imports', false, 5242880,
  array['image/jpeg', 'image/png'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy service_menu_objects_manager_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'service-menu-imports'
  and private.is_manager_at((storage.foldername(name))[1]::uuid)
);
create policy service_menu_objects_manager_select on storage.objects
for select to authenticated using (
  bucket_id = 'service-menu-imports'
  and private.is_manager_at((storage.foldername(name))[1]::uuid)
);

create or replace function app.confirm_service_import_draft(
  target_draft_id uuid,
  target_category_id uuid,
  service_name text,
  calculation app.turn_calculation_type,
  duration_minutes integer,
  listed_price numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  draft_record app.service_import_drafts;
  created_service_id uuid;
begin
  select * into draft_record from app.service_import_drafts
  where id = target_draft_id for update;
  if draft_record.id is null or not private.is_manager_at(draft_record.location_id) then
    raise exception 'Manager access required';
  end if;
  if draft_record.status <> 'draft' then raise exception 'Draft was already reviewed'; end if;

  select app.create_service_with_price(
    draft_record.location_id, target_category_id, service_name,
    calculation, duration_minutes, listed_price
  ) into created_service_id;

  update app.service_import_drafts set status = 'confirmed',
    confirmed_service_id = created_service_id, reviewed_by = (select auth.uid()),
    reviewed_at = now() where id = target_draft_id;
  return created_service_id;
end;
$$;
revoke all on function app.confirm_service_import_draft(uuid, uuid, text,
  app.turn_calculation_type, integer, numeric) from public;
grant execute on function app.confirm_service_import_draft(uuid, uuid, text,
  app.turn_calculation_type, integer, numeric) to authenticated;

comment on table app.service_menu_imports is
  'Private, idempotent Amazon Textract service-menu OCR jobs; never publishes services directly.';
