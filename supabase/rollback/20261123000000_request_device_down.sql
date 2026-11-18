-- 20261123000000_request_device.sql 되돌리기. 사람이 실행한다(supabase/migrations 밖이라 자동으로 돌지 않는다).
-- 실행 뒤 `supabase migration repair --status reverted 20261123000000 --linked`도 실행해야 나중에 다시 적용할 수 있다.
-- 기기 ID(device_id)가 모두 사라진다(요청 행은 남는다). 8개 인자 register_request를 지우고 7개 인자 함수를 원래대로 되살린다.
drop function if exists public.register_request(uuid, text, text, text, text, text, text, text);

create or replace function public.register_request(
  p_client_request_id uuid,
  p_product text,
  p_budget text,
  p_condition text,
  p_brand text,
  p_item text,
  p_condition_kind text
)
returns table (
  out_outcome text,
  out_request_id uuid,
  out_queue_number int,
  out_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_row public.requests%rowtype;
  v_attempt int;
begin
  update public.requests as r
    set status = 'expired', updated_at = now()
    where r.status = 'waiting' and r.created_at < now() - interval '24 hours';
  delete from public.requests as r
    where (r.status = 'expired' and r.created_at < now() - interval '48 hours')
       or (r.status = 'done' and r.done_at < now() - interval '7 days');

  select r.* into v_row
    from public.requests as r
    where r.client_request_id = p_client_request_id;
  if found then
    return query select 'existing'::text, v_row.id, v_row.queue_number, v_row.status;
    return;
  end if;

  for v_attempt in 1..2 loop
    begin
      insert into public.requests as r (
        client_request_id, queue_date, queue_number,
        product, budget, condition, brand, item, condition_kind
      )
      values (
        p_client_request_id,
        v_today,
        coalesce(
          (select max(q.queue_number) from public.requests as q where q.queue_date = v_today),
          0
        ) + 1,
        p_product, p_budget, p_condition, p_brand, p_item, p_condition_kind
      )
      returning r.* into v_row;
      return query select 'created'::text, v_row.id, v_row.queue_number, v_row.status;
      return;
    exception when unique_violation then
      select r.* into v_row
        from public.requests as r
        where r.client_request_id = p_client_request_id;
      if found then
        return query select 'existing'::text, v_row.id, v_row.queue_number, v_row.status;
        return;
      end if;
      if v_attempt = 2 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.register_request(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_request(uuid, text, text, text, text, text, text)
  to service_role;

-- claim_request를 원래 본문(24시간 조건에 시연 예외 없음)으로 되돌린다.
create or replace function public.claim_request(p_request_id uuid, p_volunteer_id text)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_mine uuid; v_id uuid;
begin
  select r.id into v_mine from public.requests as r
    where r.status = 'in_progress' and r.volunteer_id = p_volunteer_id;
  if v_mine is not null then
    return case when v_mine = p_request_id then 'already_mine' else 'busy' end;
  end if;
  begin
    update public.requests as r
      set status = 'in_progress', volunteer_id = p_volunteer_id, claimed_at = now(), updated_at = now()
      where r.id = p_request_id and r.status = 'waiting' and r.created_at > now() - interval '24 hours'
      returning r.id into v_id;
  exception when unique_violation then
    return 'busy';
  end;
  if v_id is not null then return 'claimed'; end if;
  -- 같은 봉사자가 다른 탭에서 방금 맡았으면(갱신이 겹친 경우) 이미 내 것이다.
  if exists (select 1 from public.requests as r
    where r.id = p_request_id and r.status = 'in_progress' and r.volunteer_id = p_volunteer_id) then
    return 'already_mine';
  end if;
  if exists (select 1 from public.requests as r where r.id = p_request_id) then return 'taken'; end if;
  return 'not_found';
end;
$$;

revoke execute on function public.claim_request(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_request(uuid, text) to service_role;

drop index if exists public.requests_device_created_at_idx;
alter table public.requests drop column if exists device_id;
