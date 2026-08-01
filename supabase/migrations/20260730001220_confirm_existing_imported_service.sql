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
  current_listed_price numeric;
begin
  select * into draft_record from app.service_import_drafts
  where id = target_draft_id for update;
  if draft_record.id is null or not private.is_manager_at(draft_record.location_id) then
    raise exception 'Manager access required';
  end if;
  if draft_record.status <> 'draft' then raise exception 'Draft was already reviewed'; end if;

  select service.id into created_service_id
  from app.services service
  where service.location_id = draft_record.location_id
    and lower(trim(service.name)) = lower(trim(service_name))
  limit 1;

  if created_service_id is null then
    select app.create_service_with_price(
      draft_record.location_id, target_category_id, service_name,
      calculation, duration_minutes, listed_price
    ) into created_service_id;
  else
    select price.listed_price into current_listed_price
    from app.service_price_versions price
    where price.service_id = created_service_id
      and price.effective_from <= now()
      and (price.effective_until is null or price.effective_until > now())
    order by price.effective_from desc limit 1;

    if current_listed_price is distinct from listed_price then
      perform app.create_service_price_version(
        created_service_id, listed_price, now(),
        'Manager-confirmed Amazon Textract menu import'
      );
    end if;
  end if;

  update app.service_import_drafts set status = 'confirmed',
    confirmed_service_id = created_service_id, reviewed_by = (select auth.uid()),
    reviewed_at = now() where id = target_draft_id;
  return created_service_id;
end;
$$;

comment on function app.confirm_service_import_draft(uuid, uuid, text,
  app.turn_calculation_type, integer, numeric) is
  'Manager review publishes a new service or safely links an existing service, adding price history only when its reviewed price changed.';
