-- 플로우 A PR 2: 대기열 접수 표와 접수 함수. TSD §8.3.
-- 플로우 B가 열을 다시 바꾸지 않게 requests 열은 모두 지금 만든다.
-- results 표와 claim/release/complete 함수는 만들지 않는다(TSD §12 4·6번).

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  queue_date date not null,
  queue_number int not null,
  product text not null check (char_length(product) <= 200),
  budget text not null check (char_length(budget) <= 200),
  condition text not null check (char_length(condition) <= 200),
  brand text,
  item text,
  condition_kind text check (condition_kind in ('new', 'used', 'any')),
  status text not null default 'waiting'
    check (status in ('waiting', 'in_progress', 'done', 'expired')),
  volunteer_id text check (volunteer_id ~ '^v-[0-9]{2}$'),
  claimed_at timestamptz,
  done_at timestamptz,
  release_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (queue_date, queue_number)
);

create index requests_status_created_at_idx on public.requests (status, created_at);

-- 브라우저(anon·authenticated)는 직접 읽고 쓰지 못한다. 서버 키(service_role)만 쓴다.
alter table public.requests enable row level security;
revoke all on table public.requests from anon, authenticated;

-- 접수. 같은 client_request_id면 기존 행(existing), 아니면 서울 날짜의 다음 번호로 삽입(created).
-- 호출될 때 보관 정리도 한다: waiting 24시간 → expired, expired는 생성 48시간 뒤 삭제,
-- done은 done_at 7일 뒤 삭제(TSD §8.3 "보관"). pg_cron은 쓰지 않는다.
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

revoke execute on function public.register_request(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_request(uuid, text, text, text, text, text, text)
  to service_role;
