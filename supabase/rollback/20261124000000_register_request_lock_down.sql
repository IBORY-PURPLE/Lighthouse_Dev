-- 20261124000000_register_request_lock.sql 되돌리기. 사람이 실행한다(supabase/migrations 밖이라 자동으로 돌지 않는다).
-- 실행 뒤 `supabase migration repair --status reverted 20261124000000 --linked`도 실행해야 나중에 다시 적용할 수 있다.
-- register_request를 20261123000000_request_device.sql의 정의(잠금 없음)로 되돌린다. 표와 행은 바뀌지 않는다.
-- 되돌리면 같은 순간에 들어온 접수가 다시 번호 충돌(23505)로 실패할 수 있다.
create or replace function public.register_request(
  p_client_request_id uuid,
  p_product text,
  p_budget text,
  p_condition text,
  p_brand text,
  p_item text,
  p_condition_kind text,
  p_device_id text default null
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
    where r.status = 'waiting' and not r.is_demo and r.created_at < now() - interval '24 hours';
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
        product, budget, condition, brand, item, condition_kind, device_id
      )
      values (
        p_client_request_id,
        v_today,
        coalesce(
          (select max(q.queue_number) from public.requests as q where q.queue_date = v_today),
          0
        ) + 1,
        p_product, p_budget, p_condition, p_brand, p_item, p_condition_kind, p_device_id
      )
      returning r.* into v_row;
      return query select 'created'::text, v_row.id, v_row.queue_number, v_row.status;
      return;
    exception when unique_violation then
      -- 같은 client_request_id가 동시에 들어왔으면 먼저 들어간 행을 돌려준다.
      select r.* into v_row
        from public.requests as r
        where r.client_request_id = p_client_request_id;
      if found then
        return query select 'existing'::text, v_row.id, v_row.queue_number, v_row.status;
        return;
      end if;
      -- 번호가 겹쳤으면 한 번만 다시 센다.
      if v_attempt = 2 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.register_request(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_request(uuid, text, text, text, text, text, text, text)
  to service_role;
