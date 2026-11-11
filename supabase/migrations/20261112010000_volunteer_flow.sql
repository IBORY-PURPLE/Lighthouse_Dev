-- 봉사자 와이어프레임 v1(2026-11-12). 추가형: 기존 행과 register_request는 그대로 둔다.
alter table public.requests drop constraint requests_volunteer_id_check;
alter table public.requests add constraint requests_volunteer_id_check
  check (volunteer_id ~ '^(v-[0-9]{2}|d-[0-9a-f]{16})$');
alter table public.requests add column is_demo boolean not null default false;
create unique index requests_one_in_progress_per_volunteer
  on public.requests (volunteer_id) where status = 'in_progress';

create table public.results (
  request_id uuid primary key references public.requests (id) on delete cascade,
  volunteer_id text not null check (volunteer_id ~ '^(v-[0-9]{2}|d-[0-9a-f]{16})$'),
  candidates jsonb not null check (case when jsonb_typeof(candidates) = 'array'
    then jsonb_array_length(candidates) between 1 and 3 else false end),
  sent_at timestamptz not null default now(),
  heard_at timestamptz,
  link_opened_at timestamptz
);
create index results_volunteer_sent_idx on public.results (volunteer_id, sent_at desc);
alter table public.results enable row level security;
revoke all on table public.results from anon, authenticated;

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
  if exists (select 1 from public.requests as r where r.id = p_request_id) then return 'taken'; end if;
  return 'not_found';
end;
$$;

create or replace function public.release_request(p_request_id uuid, p_volunteer_id text)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  update public.requests as r
    set status = 'waiting', volunteer_id = null, claimed_at = null,
        release_count = r.release_count + 1, updated_at = now()
    where r.id = p_request_id and r.status = 'in_progress' and r.volunteer_id = p_volunteer_id
    returning r.id into v_id;
  if v_id is not null then return 'released'; end if;
  if exists (select 1 from public.requests as r where r.id = p_request_id) then return 'not_yours'; end if;
  return 'not_found';
end;
$$;

create or replace function public.complete_request(p_request_id uuid, p_volunteer_id text, p_candidates jsonb)
returns table (out_outcome text, out_sent_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_sent timestamptz;
begin
  select res.sent_at into v_sent from public.results as res
    where res.request_id = p_request_id and res.volunteer_id = p_volunteer_id;
  if v_sent is not null then return query select 'existing'::text, v_sent; return; end if;
  update public.requests as r set status = 'done', done_at = now(), updated_at = now()
    where r.id = p_request_id and r.status = 'in_progress' and r.volunteer_id = p_volunteer_id
    returning r.id into v_id;
  if v_id is null then
    return query select case when exists (select 1 from public.requests as r where r.id = p_request_id)
      then 'not_yours'::text else 'not_found'::text end, null::timestamptz;
    return;
  end if;
  insert into public.results as res (request_id, volunteer_id, candidates)
    values (p_request_id, p_volunteer_id, p_candidates) returning res.sent_at into v_sent;
  return query select 'completed'::text, v_sent;
end;
$$;

create or replace function public.reset_demo_requests(p_volunteer_id text)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Seoul')::date; v_next int; v_done uuid;
begin
  delete from public.requests as r where r.is_demo;
  select coalesce(max(q.queue_number), 0) into v_next from public.requests as q where q.queue_date = v_today;
  insert into public.requests (client_request_id, queue_date, queue_number, product, budget, condition,
    brand, item, condition_kind, is_demo, created_at)
  values
    (gen_random_uuid(), v_today, v_next + 1, '소니 무선 헤드셋 사고 싶어요', '30만 원 안쪽', '새 제품', '소니', '헤드셋', 'new', true, now() - interval '72 minutes'),
    (gen_random_uuid(), v_today, v_next + 2, '세탁 세제 리필용 큰 것', '2만 원 안쪽', '새 제품', null, '세탁세제', 'new', true, now() - interval '47 minutes'),
    (gen_random_uuid(), v_today, v_next + 3, '무선 키보드, 조용한 것', '5만 원쯤', '새 제품', null, '키보드', 'new', true, now() - interval '21 minutes'),
    (gen_random_uuid(), v_today, v_next + 4, '전기포트 1.7리터', '4만 원 안쪽', '상관없어요', null, '전기포트', 'any', true, now() - interval '9 minutes'),
    (gen_random_uuid(), v_today, v_next + 5, '엄마 쓰실 전기요, 싱글 사이즈', '10만 원 안쪽', '새 제품', null, '전기요', 'new', true, now() - interval '2 minutes');
  if p_volunteer_id is not null then
    insert into public.requests as r (client_request_id, queue_date, queue_number, product, budget, condition,
      item, condition_kind, is_demo, status, volunteer_id, created_at, claimed_at, done_at)
    values (gen_random_uuid(), v_today, v_next + 6, '아이 실내화 210 사이즈, 흰색', '3만 원 안쪽', '새 제품',
      '실내화', 'new', true, 'done', p_volunteer_id,
      now() - interval '1 day 40 minutes', now() - interval '1 day 30 minutes', now() - interval '1 day')
    returning r.id into v_done;
    insert into public.results (request_id, volunteer_id, candidates, sent_at) values (v_done, p_volunteer_id, '[
      {"name": "아동 EVA 실내화 흰색 (시연용 예시 1)", "url": "https://search.11st.co.kr/pc/total-search?kwd=%EC%95%84%EB%8F%99%20%EC%8B%A4%EB%82%B4%ED%99%94%20%ED%9D%B0%EC%83%89%20210", "guide": "‘구매하기’를 누르고 사이즈 210을 고릅니다.", "summary": [{"label": "사이즈", "value": "210"}, {"label": "색상", "value": "흰색"}, {"label": "소재", "value": "EVA"}]},
      {"name": "아동 실내화 흰색 (시연용 예시 2)", "url": "https://search.11st.co.kr/pc/total-search?kwd=%EC%95%84%EB%8F%99%20%EC%8B%A4%EB%82%B4%ED%99%94%20%ED%9D%B0%EC%83%89%20210", "guide": "옵션에서 흰색과 210을 고른 뒤 ‘구매하기’를 누릅니다.", "summary": [{"label": "사이즈", "value": "210"}, {"label": "색상", "value": "흰색"}]}
    ]'::jsonb, now() - interval '1 day');
  end if;
  return 5;
end;
$$;

revoke execute on function public.claim_request(uuid, text), public.release_request(uuid, text),
  public.complete_request(uuid, text, jsonb), public.reset_demo_requests(text) from public, anon, authenticated;
grant execute on function public.claim_request(uuid, text), public.release_request(uuid, text),
  public.complete_request(uuid, text, jsonb), public.reset_demo_requests(text) to service_role;
