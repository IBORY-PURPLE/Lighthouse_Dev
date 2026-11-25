-- 동시 접수 고치기(2026-11-24). 여러 이용자가 같은 순간에 접수하면 대기번호(그날 최대값+1)가 겹쳐
-- unique (queue_date, queue_number)에 걸리고, 한 번 다시 세어도 또 겹치면 접수가 오류로 끝났다.
-- 확인: Postgres 17에서 연결 10개가 같은 순간에 부르면 200건 가운데 63건만 접수됐다(나머지는 23505).
-- 고침: 접수를 트랜잭션 잠금(pg_advisory_xact_lock)으로 한 줄로 세운다. 잠금은 트랜잭션이 끝나면 저절로 풀린다.
-- 인자, 돌려주는 값, 실행 권한(service_role만)은 20261123000000_request_device.sql과 같다. 앱 코드는 바꾸지 않는다.
-- created_at은 잠금을 얻은 뒤의 시각(clock_timestamp)이다. 그래서 대기열 순서(created_at)와 대기번호 순서가 같다.
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
  v_now timestamptz;
  v_today date;
  v_row public.requests%rowtype;
  v_attempt int;
begin
  -- 접수는 한 번에 하나씩. 먼저 온 접수가 끝나야(커밋) 다음 접수가 번호를 센다.
  perform pg_advisory_xact_lock(hashtextextended('lighthouse.register_request', 0));
  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Asia/Seoul')::date;

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

  -- 잠금 덕분에 겹치지 않지만, 옛 함수가 아직 도는 순간(마이그레이션 적용 중)에 대비해 다시 세기를 남겨 둔다.
  for v_attempt in 1..2 loop
    begin
      insert into public.requests as r (
        client_request_id, queue_date, queue_number,
        product, budget, condition, brand, item, condition_kind, device_id,
        created_at, updated_at
      )
      values (
        p_client_request_id,
        v_today,
        coalesce(
          (select max(q.queue_number) from public.requests as q where q.queue_date = v_today),
          0
        ) + 1,
        p_product, p_budget, p_condition, p_brand, p_item, p_condition_kind, p_device_id,
        v_now, v_now
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

revoke execute on function public.register_request(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_request(uuid, text, text, text, text, text, text, text)
  to service_role;
