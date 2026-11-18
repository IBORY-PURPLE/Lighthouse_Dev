-- 이용자 기기 구분(2026-11-18). 요청에 접수한 기기 ID(device_id)를 붙여, 기기마다 자기 요청만 본다.
-- 추가형: 기존 행은 device_id가 비어 있고(옛 요청·시연 요청) 지금처럼 번호만 알면 조회된다.
-- register_request는 마지막 인자 p_device_id(기본 null)가 늘어난다. 지금 운영 앱의 7개 인자 호출은 그대로 된다.
-- 시연 요청(is_demo)은 24시간이 지나도 expired로 바꾸지 않는다(봉사자 대기열에 계속 보인다).
alter table public.requests add column device_id text;

-- 기기 목록(최신순)과 소유 확인용. 기기 ID가 있는 행만 담는다.
create index requests_device_created_at_idx
  on public.requests (device_id, created_at desc) where device_id is not null;

-- 같은 이름의 7개 인자 함수를 지우고 8개 인자 함수를 만든다(둘이 남으면 이름만으로 부를 때 모호하다).
drop function public.register_request(uuid, text, text, text, text, text, text);

-- 접수. 같은 client_request_id면 기존 행(existing, device_id는 덮어쓰지 않는다), 아니면 서울 날짜의 다음 번호로 삽입(created).
-- 호출될 때 보관 정리도 한다: waiting 24시간 → expired(시연 요청 제외), expired는 생성 48시간 뒤 삭제,
-- done은 done_at 7일 뒤 삭제(TSD §8.3 "보관"). pg_cron은 쓰지 않는다.
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
