-- 봉사자 리서치 챗 대화형(demo5) PR 1: 대화 저장 표 6개와 함수. design.md 5.1.
-- 추가형이다. 기존 표·열·함수 5개(register_request, claim_request, release_request,
-- complete_request, reset_demo_requests)는 바꾸지 않는다. photo_links와 사진 링크 함수는 마이그레이션 2(P1).
-- 잠금 순서는 언제나 requests → research_sessions → research_usage → ai_usage_daily 이다.

create table public.research_sessions (
  request_id uuid primary key references public.requests (id) on delete cascade,
  session_id uuid not null unique default gen_random_uuid(),
  volunteer_id text not null check (volunteer_id ~ '^(v-[0-9]{2}|d-[0-9a-f]{16})$'),
  purchase text not null default 'unset' check (purchase in ('unset', 'bought', 'research')),
  -- 칸별 {value, links[], status: filled|confirmed|skipped, by, short?, at}. 빈 칸은 키가 없다.
  slots jsonb not null default '{}'::jsonb
    check (jsonb_typeof(slots) = 'object' and octet_length(slots::text) <= 30000),
  extras jsonb not null default '[]'::jsonb
    check (jsonb_typeof(extras) = 'array' and jsonb_array_length(extras) <= 3
      and octet_length(extras::text) <= 4000),
  counters jsonb not null default '{"asked": {}, "reasked": {}}'::jsonb
    check (jsonb_typeof(counters) = 'object' and octet_length(counters::text) <= 4000),
  pending jsonb not null default '{}'::jsonb
    check (jsonb_typeof(pending) = 'object' and octet_length(pending::text) <= 8000),
  review jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review) = 'object' and octet_length(review::text) <= 8000),
  search_cache jsonb not null default '{}'::jsonb
    check (jsonb_typeof(search_cache) = 'object' and octet_length(search_cache::text) <= 4000),
  version int not null default 0 check (version >= 0),
  next_seq int not null default 1 check (next_seq >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.research_messages (
  request_id uuid not null references public.research_sessions (request_id) on delete cascade,
  seq int not null,
  role text not null check (role in ('ai', 'volunteer', 'system')),
  tag text,
  slot text,
  body jsonb not null check (octet_length(body::text) <= 8192),
  turn_id text,
  ai text check (ai in ('ok', 'fallback', 'none', 'capped')),
  created_at timestamptz not null default now(),
  primary key (request_id, seq)
);

create table public.research_turns (
  request_id uuid not null references public.research_sessions (request_id) on delete cascade,
  client_turn_id text not null check (char_length(client_turn_id) between 1 and 100),
  first_seq int,
  last_seq int,
  -- begin이 사용량(요청당·하루 AI 호출)을 올린 자리인가. apply가 stale로 끝나면 이 값으로 되돌린다.
  counted boolean not null default false,
  -- null이면 처리 중 자리. 같은 clientTurnId가 다시 오면 202.
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (request_id, client_turn_id)
);

create table public.research_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.research_sessions (request_id) on delete cascade,
  thumb text not null check (char_length(thumb) <= 60000 and thumb ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'),
  -- 사진 AI 설명은 11/18 뒤(P2). 그때까지 null.
  description text check (char_length(description) <= 200),
  seen_model text check (char_length(seen_model) <= 100),
  shot text check (shot in ('photo', 'screenshot', 'unclear')),
  created_at timestamptz not null default now()
);
create index research_photos_request_idx on public.research_photos (request_id, created_at);

-- 요청당 사용량. 세션이 지워져도(내려놓기·보내기) 남는다. 요청이 지워질 때만 같이 지워진다.
create table public.research_usage (
  request_id uuid primary key references public.requests (id) on delete cascade,
  turns int not null default 0 check (turns >= 0),
  searches int not null default 0 check (searches >= 0),
  photo_uploads int not null default 0 check (photo_uploads >= 0),
  reviews int not null default 0 check (reviews >= 0),
  updated_at timestamptz not null default now()
);

create table public.ai_usage_daily (
  day date primary key,
  searches int not null default 0 check (searches >= 0),
  ai_calls int not null default 0 check (ai_calls >= 0),
  updated_at timestamptz not null default now()
);

alter table public.research_sessions enable row level security;
alter table public.research_messages enable row level security;
alter table public.research_turns enable row level security;
alter table public.research_photos enable row level security;
alter table public.research_usage enable row level security;
alter table public.ai_usage_daily enable row level security;
revoke all on table public.research_sessions, public.research_messages, public.research_turns,
  public.research_photos, public.research_usage, public.ai_usage_daily from anon, authenticated;
grant select, insert, update, delete on table public.research_sessions, public.research_messages,
  public.research_turns, public.research_photos, public.research_usage, public.ai_usage_daily
  to service_role;

-- ---------- 보조 함수(앞 5개는 순수 계산, research_guard·research_push_messages는 호출자의 잠금 안에서 쓴다) ----------

-- null 값 키를 지우며 합친다. pending·counters 패치용.
create or replace function public.research_merge(p_old jsonb, p_new jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return coalesce((
    select jsonb_object_agg(e.k, e.v)
    from jsonb_each(coalesce(p_old, '{}'::jsonb) || coalesce(p_new, '{}'::jsonb)) as e(k, v)
    where jsonb_typeof(e.v) <> 'null'
  ), '{}'::jsonb);
end;
$$;

-- 질문 가능: 비어 있고(키 없음), 확인 필요가 걸린 칸이 아니고, 사진 칸은 구매함일 때만.
create or replace function public.research_slot_askable(p_s public.research_sessions, p_slot text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_s.slots->p_slot->>'status' is not null then return false; end if;
  if p_slot = 'photo' and p_s.purchase <> 'bought' then return false; end if;
  if coalesce(p_s.pending->'mismatch'->>'slot', '') = p_slot
     or coalesce(p_s.pending->'shotCheck'->>'slot', '') = p_slot
     or coalesce(p_s.pending->'confirmFill'->>'slot', '') = p_slot then
    return false;
  end if;
  return true;
end;
$$;

-- 비어 있는 필수. 구매 여부(purchase)도 필수로 센다.
create or replace function public.research_required_missing(p_s public.research_sessions)
returns text[] language plpgsql security invoker set search_path = '' as $$
declare
  v_missing text[] := '{}';
  v_slot text;
begin
  if p_s.purchase = 'unset' then v_missing := array_append(v_missing, 'purchase'); end if;
  foreach v_slot in array array['model', 'pros', 'altReason'] loop
    if coalesce(p_s.slots->v_slot->>'status', '') not in ('filled', 'confirmed') then
      v_missing := array_append(v_missing, v_slot);
    end if;
  end loop;
  if p_s.purchase = 'bought'
     and coalesce(p_s.slots->'photo'->>'status', '') not in ('filled', 'confirmed') then
    v_missing := array_append(v_missing, 'photo');
  end if;
  return v_missing;
end;
$$;

-- 다음 질문 후보가 지금 상태에서 유효한가(design.md 4.5).
-- 후보: {action: ask_purchase|ask_slot|reask|pending_notice|ask_extra|propose_review, slot?, message}
create or replace function public.research_next_valid(p_s public.research_sessions, p_cand jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_action text := p_cand->>'action';
  v_slot text := p_cand->>'slot';
  v_q constant text[] := array['model', 'pros', 'photo', 'alts', 'altReason', 'benefits', 'refs'];
  v_required text[] := array['model', 'pros', 'altReason'];
  v_unresolved boolean;
  v_past boolean;
  v_q_slot text;
begin
  v_unresolved := coalesce(jsonb_typeof(p_s.pending->'mismatch'), '') = 'object'
    or coalesce(jsonb_typeof(p_s.pending->'shotCheck'), '') = 'object'
    or coalesce(jsonb_typeof(p_s.pending->'confirmFill'), '') = 'object';
  if v_action = 'ask_purchase' then return p_s.purchase = 'unset'; end if;
  -- 구매 여부가 정해지기 전에는 구매 질문만 유효하다.
  if p_s.purchase = 'unset' then return false; end if;
  if p_s.purchase = 'bought' then v_required := array_append(v_required, 'photo'); end if;
  if v_action = 'pending_notice' then return v_unresolved; end if;
  if v_action in ('ask_slot', 'reask') then
    if v_slot is null or not (v_slot = any(v_q)) then return false; end if;
    if not public.research_slot_askable(p_s, v_slot) then return false; end if;
    if v_action = 'reask' then
      return coalesce((p_s.counters->'reasked'->>v_slot)::int, 0) < 1;
    end if;
    -- 이미 물은 칸은 필수일 때만 다시 묻는다(둘째 회차).
    return p_s.counters->'asked'->v_slot is null or v_slot = any(v_required);
  end if;
  if v_action in ('ask_extra', 'propose_review') then
    -- 질문 7을 지났다 = 첫 회차 후보(질문 가능하고 아직 안 물은 칸)가 없다.
    v_past := true;
    foreach v_q_slot in array v_q loop
      if public.research_slot_askable(p_s, v_q_slot) and p_s.counters->'asked'->v_q_slot is null then
        v_past := false;
      end if;
    end loop;
    if not v_past then return false; end if;
    if array_length(public.research_required_missing(p_s), 1) is not null then return false; end if;
    if v_action = 'ask_extra' then return jsonb_array_length(p_s.extras) < 3; end if;
    return not v_unresolved;
  end if;
  return false;
end;
$$;

-- 요청 행을 먼저 잠그고 소유를 확인한 뒤 세션 행을 잠근다. 잠금은 트랜잭션 끝까지 간다.
-- p_lock 'share': requests for share(세션을 쓰는 함수). 'update': for no key update(requests를 바꾸는 send).
-- 돌려주는 값: ok | not_found | not_in_progress | not_yours | session_changed
create or replace function public.research_guard(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_lock text default 'share'
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_status text;
  v_volunteer text;
  v_sid uuid;
  v_svol text;
begin
  if p_lock = 'update' then
    select r.status, r.volunteer_id into v_status, v_volunteer
      from public.requests as r where r.id = p_request_id for no key update;
  else
    select r.status, r.volunteer_id into v_status, v_volunteer
      from public.requests as r where r.id = p_request_id for share;
  end if;
  if not found then return 'not_found'; end if;
  if v_status <> 'in_progress' then return 'not_in_progress'; end if;
  if v_volunteer is distinct from p_volunteer_id then return 'not_yours'; end if;
  select s.session_id, s.volunteer_id into v_sid, v_svol
    from public.research_sessions as s where s.request_id = p_request_id for update;
  if not found then return 'session_changed'; end if;
  if v_svol <> p_volunteer_id then return 'session_changed'; end if;
  if p_session_id is not null and v_sid <> p_session_id then return 'session_changed'; end if;
  return 'ok';
end;
$$;

-- 세션 잠금을 쥔 채 메시지를 넣는다. p_messages: [{role, tag, slot, body, ai}]. 넣은 행을 돌려준다.
create or replace function public.research_push_messages(
  p_request_id uuid, p_messages jsonb, p_turn_id text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_seq int;
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_now timestamptz := now();
begin
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' then return v_out; end if;
  select s.next_seq into v_seq from public.research_sessions as s where s.request_id = p_request_id;
  for v_item in select e.value from jsonb_array_elements(p_messages) as e loop
    insert into public.research_messages (request_id, seq, role, tag, slot, body, turn_id, ai, created_at)
    values (p_request_id, v_seq, v_item->>'role', v_item->>'tag', v_item->>'slot',
      coalesce(v_item->'body', '{}'::jsonb), p_turn_id, v_item->>'ai', v_now);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'seq', v_seq, 'role', v_item->>'role', 'tag', v_item->>'tag', 'slot', v_item->>'slot',
      'body', coalesce(v_item->'body', '{}'::jsonb), 'turnId', p_turn_id, 'ai', v_item->>'ai'));
    v_seq := v_seq + 1;
  end loop;
  update public.research_sessions as s set next_seq = v_seq where s.request_id = p_request_id;
  return v_out;
end;
$$;

-- 세션 한 장의 읽기 모양. p_after가 null이면 메시지 전부(500개까지), 있으면 그보다 큰 seq 50개까지.
-- 한 문장으로 읽어 한 스냅숏이다. p_volunteer_id가 있으면 같은 문장 안에서 "이 봉사자의 in_progress 요청이고
-- 세션도 이 봉사자 것"일 때만 돌려준다(폴링이 소유 확인과 읽기 사이의 경합으로 남의 대화를 읽지 않게).
-- 없거나 조건이 안 맞으면 null.
create or replace function public.research_view(
  p_request_id uuid, p_after int default null, p_with_thumbs boolean default false,
  p_volunteer_id text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_out jsonb;
begin
  select jsonb_build_object(
      'sessionId', s.session_id, 'volunteerId', s.volunteer_id, 'purchase', s.purchase,
      'slots', s.slots, 'extras', s.extras, 'counters', s.counters, 'pending', s.pending,
      'review', s.review, 'version', s.version, 'lastSeq', s.next_seq - 1,
      'createdAt', s.created_at, 'updatedAt', s.updated_at,
      'photos', coalesce((
        select jsonb_agg(
            jsonb_build_object('id', p.id, 'description', p.description, 'seenModel', p.seen_model,
              'shot', p.shot, 'createdAt', p.created_at)
              || case when p_with_thumbs then jsonb_build_object('thumb', p.thumb) else '{}'::jsonb end
            order by p.created_at, p.id)
        from public.research_photos as p where p.request_id = s.request_id), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
            'seq', m.seq, 'role', m.role, 'tag', m.tag, 'slot', m.slot, 'body', m.body,
            'turnId', m.turn_id, 'ai', m.ai, 'createdAt', m.created_at) order by m.seq)
        from (
          select x.* from public.research_messages as x
          where x.request_id = s.request_id and (p_after is null or x.seq > p_after)
          order by x.seq
          limit case when p_after is null then 500 else 50 end
        ) as m), '[]'::jsonb))
    into v_out
    from public.research_sessions as s
    where s.request_id = p_request_id
      and (p_volunteer_id is null or (
        s.volunteer_id = p_volunteer_id
        and exists (select 1 from public.requests as r
          where r.id = s.request_id and r.status = 'in_progress' and r.volunteer_id = p_volunteer_id)));
  return v_out;
end;
$$;

-- ---------- 정리 ----------

-- 6시간 넘게 아무 활동이 없는 in_progress 요청을 release_request와 같은 값으로 대기열에 돌린다.
-- 활동 = greatest(claimed_at, 세션 updated_at). 세션은 트리거가 지운다. 돌려 준 요청 수를 반환한다.
create or replace function public.research_sweep(p_idle interval default interval '6 hours')
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_ids uuid[];
  v_count int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('lighthouse.research_sweep')) then return 0; end if;
  -- 1단계: 오래된 요청만 골라 잠근다. 다른 트랜잭션이 쓰는 행은 건너뛴다(skip locked).
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select r.id from public.requests as r
    where r.status = 'in_progress'
      and greatest(r.claimed_at, coalesce(
        (select s.updated_at from public.research_sessions as s where s.request_id = r.id),
        r.claimed_at)) < now() - p_idle
    order by r.id
    for update skip locked
  ) as x;
  -- 2단계: 잠근 뒤 새 스냅숏으로 같은 조건을 다시 비교하고 되돌린다. 트리거가 세션을 지운다.
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    with moved as (
      update public.requests as r
        set status = 'waiting', volunteer_id = null, claimed_at = null,
            release_count = r.release_count + 1, updated_at = now()
        where r.id = any(v_ids) and r.status = 'in_progress'
          and greatest(r.claimed_at, coalesce(
            (select s.updated_at from public.research_sessions as s where s.request_id = r.id),
            r.claimed_at)) < now() - p_idle
        returning r.id
    )
    select count(*) into v_count from moved;
  end if;
  return v_count;
end;
$$;

-- 요청이 in_progress에서 벗어나거나 봉사자가 바뀌면 세션(과 메시지·턴·사진)을 지운다. research_usage는 남는다.
create or replace function public.research_drop_on_leave()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.research_sessions as s where s.request_id = old.id;
  return null;
end;
$$;

create trigger research_drop_on_leave
  after update of status, volunteer_id on public.requests
  for each row
  when (old.status = 'in_progress'
        and (new.status is distinct from old.status or new.volunteer_id is distinct from old.volunteer_id))
  execute function public.research_drop_on_leave();

-- ---------- 열기·읽기 ----------

-- p_after가 null이면 열기: 세션이 없으면 만들고 전부 돌려준다. p_after가 있으면 읽기만(폴링)이다.
-- 돌려주는 값: {outcome: ok|not_found|not_in_progress|not_yours|session_changed, view?}
create or replace function public.research_open(
  p_request_id uuid, p_volunteer_id text, p_after int default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_status text;
  v_volunteer text;
  v_guard text;
  v_view jsonb;
begin
  if p_after is not null then
    -- 읽기: 잠그지 않는다. 소유 확인과 읽기를 한 문장(research_view)에서 해서, 그 사이에 요청이 넘어가도
    -- 남의 대화를 돌려주지 않는다. null이면 이유만 따로 알아본다(데이터는 돌려주지 않음).
    v_view := public.research_view(p_request_id, p_after, false, p_volunteer_id);
    if v_view is not null then return jsonb_build_object('outcome', 'ok', 'view', v_view); end if;
    select r.status, r.volunteer_id into v_status, v_volunteer
      from public.requests as r where r.id = p_request_id;
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    if v_status <> 'in_progress' then return jsonb_build_object('outcome', 'not_in_progress'); end if;
    if v_volunteer is distinct from p_volunteer_id then return jsonb_build_object('outcome', 'not_yours'); end if;
    return jsonb_build_object('outcome', 'session_changed');
  end if;

  select r.status into v_status from public.requests as r where r.id = p_request_id for share;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  perform public.research_sweep();
  select r.status, r.volunteer_id into v_status, v_volunteer
    from public.requests as r where r.id = p_request_id;
  if v_status <> 'in_progress' then return jsonb_build_object('outcome', 'not_in_progress'); end if;
  if v_volunteer is distinct from p_volunteer_id then return jsonb_build_object('outcome', 'not_yours'); end if;
  insert into public.research_sessions (request_id, volunteer_id)
    values (p_request_id, p_volunteer_id)
    on conflict (request_id) do nothing;
  v_guard := public.research_guard(p_request_id, p_volunteer_id, null);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  return jsonb_build_object('outcome', 'ok', 'view', public.research_view(p_request_id, null, true));
end;
$$;

-- ---------- 시작: 소유·중복·stale·캐시·상한 ----------

-- p_kind: turn | search | photo | review. p_caps: {turns, searches, photoUploads, reviews, dailySearches, dailyAi}.
-- 돌려주는 값 outcome:
--   ok(+ai: ok|capped, cap: request|daily, session) | duplicate(+response) | pending | stale(+version)
--   cached | capped(+cap) | photos_full | photo_not_needed | bad_request | 소유 오류 4가지
create or replace function public.research_begin(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_kind text,
  p_base_version int default null, p_client_turn_id text default null,
  p_cache_key text default null, p_units int default 1, p_caps jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_guard text;
  v_s public.research_sessions%rowtype;
  v_turn public.research_turns%rowtype;
  v_has_turn boolean;
  v_usage public.research_usage%rowtype;
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_taken date;
  v_cap_turns int := coalesce((p_caps->>'turns')::int, 40);
  v_cap_searches int := coalesce((p_caps->>'searches')::int, 12);
  v_cap_photos int := coalesce((p_caps->>'photoUploads')::int, 6);
  v_cap_reviews int := coalesce((p_caps->>'reviews')::int, 3);
  v_cap_day_searches int := coalesce((p_caps->>'dailySearches')::int, 60);
  v_cap_day_ai int := coalesce((p_caps->>'dailyAi')::int, 600);
  v_cache jsonb;
  v_d_searches int := 0;
  v_d_ai int := 0;
  v_units int := greatest(coalesce(p_units, 1), 1);
begin
  if p_kind not in ('turn', 'search', 'photo', 'review') then
    return jsonb_build_object('outcome', 'bad_request');
  end if;
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;

  if p_kind = 'turn' then
    if p_client_turn_id is null then return jsonb_build_object('outcome', 'bad_request'); end if;
    select t.* into v_turn from public.research_turns as t
      where t.request_id = p_request_id and t.client_turn_id = p_client_turn_id;
    v_has_turn := found;
    if v_has_turn then
      if v_turn.response is null then return jsonb_build_object('outcome', 'pending'); end if;
      return jsonb_build_object('outcome', 'duplicate', 'response', v_turn.response);
    end if;
  end if;

  -- baseVersion이 다르면 세지 않고 돌려준다. 검색은 version을 올리지 않아 보통 null로 부른다.
  if p_base_version is not null and p_base_version <> v_s.version then
    return jsonb_build_object('outcome', 'stale', 'version', v_s.version);
  end if;

  if p_kind = 'search' and p_cache_key is not null then
    v_cache := v_s.search_cache->p_cache_key;
    if v_cache->>'state' = 'done' then return jsonb_build_object('outcome', 'cached'); end if;
    -- 진행 중 표시는 90초 안일 때만 믿는다(서버 함수가 죽어 남은 표시를 풀기 위해).
    if v_cache->>'state' = 'pending'
       and (v_cache->>'at')::double precision > extract(epoch from now()) - 90 then
      return jsonb_build_object('outcome', 'pending');
    end if;
  end if;

  if p_kind = 'photo' then
    if v_s.purchase = 'research' then return jsonb_build_object('outcome', 'photo_not_needed'); end if;
    if (select count(*) from public.research_photos as p where p.request_id = p_request_id) >= 3 then
      return jsonb_build_object('outcome', 'photos_full');
    end if;
  end if;

  insert into public.research_usage (request_id) values (p_request_id) on conflict (request_id) do nothing;
  select u.* into v_usage from public.research_usage as u where u.request_id = p_request_id for update;

  -- 요청당 상한 확인
  if (p_kind = 'turn' and v_usage.turns >= v_cap_turns)
     or (p_kind = 'search' and v_usage.searches + v_units > v_cap_searches)
     or (p_kind = 'photo' and v_usage.photo_uploads >= v_cap_photos)
     or (p_kind = 'review' and v_usage.reviews >= v_cap_reviews) then
    if p_kind = 'turn' then
      insert into public.research_turns (request_id, client_turn_id) values (p_request_id, p_client_turn_id);
      return jsonb_build_object('outcome', 'ok', 'ai', 'capped', 'cap', 'request', 'version', v_s.version,
        'session', public.research_view(p_request_id, v_s.next_seq, false));
    end if;
    return jsonb_build_object('outcome', 'capped', 'cap', 'request');
  end if;

  -- 하루 상한: 넘으면 행이 안 돌아온다.
  if p_kind = 'search' then v_d_searches := v_units; else v_d_ai := 1; end if;
  -- 그날 첫 사용이라 행이 없을 때도 상한을 넘으면 막는다(insert 쪽은 on conflict의 where를 안 본다).
  if v_d_searches <= v_cap_day_searches and v_d_ai <= v_cap_day_ai then
    insert into public.ai_usage_daily as d (day, searches, ai_calls) values (v_day, v_d_searches, v_d_ai)
      on conflict (day) do update
        set searches = d.searches + excluded.searches, ai_calls = d.ai_calls + excluded.ai_calls,
            updated_at = now()
        where d.searches + excluded.searches <= v_cap_day_searches
          and d.ai_calls + excluded.ai_calls <= v_cap_day_ai
      returning d.day into v_taken;
  end if;
  if v_taken is null then
    if p_kind = 'turn' then
      insert into public.research_turns (request_id, client_turn_id) values (p_request_id, p_client_turn_id);
      return jsonb_build_object('outcome', 'ok', 'ai', 'capped', 'cap', 'daily', 'version', v_s.version,
        'session', public.research_view(p_request_id, v_s.next_seq, false));
    end if;
    return jsonb_build_object('outcome', 'capped', 'cap', 'daily');
  end if;

  update public.research_usage as u set
      turns = u.turns + case when p_kind = 'turn' then 1 else 0 end,
      searches = u.searches + case when p_kind = 'search' then v_units else 0 end,
      photo_uploads = u.photo_uploads + case when p_kind = 'photo' then 1 else 0 end,
      reviews = u.reviews + case when p_kind = 'review' then 1 else 0 end,
      updated_at = now()
    where u.request_id = p_request_id;

  if p_kind = 'turn' then
    insert into public.research_turns (request_id, client_turn_id, counted)
      values (p_request_id, p_client_turn_id, true);
  elsif p_kind = 'search' and p_cache_key is not null then
    update public.research_sessions as s
      set search_cache = s.search_cache || jsonb_build_object(p_cache_key,
        jsonb_build_object('state', 'pending', 'at', extract(epoch from now())))
      where s.request_id = p_request_id;
  end if;
  return jsonb_build_object('outcome', 'ok', 'ai', 'ok', 'version', v_s.version,
    'session', public.research_view(p_request_id, v_s.next_seq, false));
end;
$$;

-- ---------- 턴 반영 ----------

-- p_patch: {purchase?, slots?: {slot: {value, status, by, ...} | null}, extras?: [...],
--           asked?: [slot], reasked?: [slot], pending?: {key: obj | null}}
-- p_messages: 이번 턴 메시지 [{role, tag, slot, body, ai}]. p_next: 다음 질문 후보(첫 유효 후보 하나만 넣는다).
-- 돌려주는 값: {outcome: ok(+response) | duplicate(+response) | stale(+version) | bad_patch | 소유 오류}
create or replace function public.research_apply(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_client_turn_id text,
  p_base_version int, p_patch jsonb, p_messages jsonb, p_next jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_guard text;
  v_s public.research_sessions%rowtype;
  v_n public.research_sessions%rowtype;
  v_turn public.research_turns%rowtype;
  v_has_turn boolean;
  v_q constant text[] := array['model', 'pros', 'photo', 'alts', 'altReason', 'benefits', 'refs'];
  v_purchase text;
  v_slots jsonb;
  v_extras jsonb;
  v_counters jsonb;
  v_pending jsonb;
  v_review jsonb;
  v_changed boolean;
  v_version int;
  v_key text;
  v_val jsonb;
  v_cand jsonb;
  v_chosen jsonb := null;
  v_all jsonb;
  v_inserted jsonb;
  v_first int;
  v_last int;
  v_resp jsonb;
  v_action text;
  v_slot text;
begin
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  select t.* into v_turn from public.research_turns as t
    where t.request_id = p_request_id and t.client_turn_id = p_client_turn_id;
  v_has_turn := found;
  if v_has_turn and v_turn.response is not null then
    return jsonb_build_object('outcome', 'duplicate', 'response', v_turn.response);
  end if;
  if p_base_version is not null and p_base_version <> v_s.version then
    if v_has_turn then
      -- stale은 세지 않는다: begin이 올린 사용량을 되돌리고(요청당 → 하루 순서) 처리 중 자리를 지운다.
      if v_turn.counted then
        update public.research_usage as u set turns = greatest(u.turns - 1, 0), updated_at = now()
          where u.request_id = p_request_id;
        update public.ai_usage_daily as d set ai_calls = greatest(d.ai_calls - 1, 0), updated_at = now()
          where d.day = (v_turn.created_at at time zone 'Asia/Seoul')::date;
      end if;
      delete from public.research_turns as t
        where t.request_id = p_request_id and t.client_turn_id = p_client_turn_id;
    end if;
    return jsonb_build_object('outcome', 'stale', 'version', v_s.version);
  end if;

  v_purchase := coalesce(p_patch->>'purchase', v_s.purchase);
  if v_purchase not in ('unset', 'bought', 'research') then return jsonb_build_object('outcome', 'bad_patch'); end if;
  v_slots := v_s.slots;
  if jsonb_typeof(p_patch->'slots') = 'object' then
    for v_key, v_val in select e.key, e.value from jsonb_each(p_patch->'slots') as e loop
      -- photo 칸은 research_add_photo·research_remove_photo만 바꾼다(사진 행과 어긋나지 않게).
      if not (v_key = any(v_q)) or v_key = 'photo' then return jsonb_build_object('outcome', 'bad_patch'); end if;
      if jsonb_typeof(v_val) = 'null' then
        v_slots := v_slots - v_key;
      else
        if jsonb_typeof(v_val) <> 'object' or coalesce(v_val->>'status', '') not in ('filled', 'confirmed', 'skipped') then
          return jsonb_build_object('outcome', 'bad_patch');
        end if;
        -- 채운 칸(filled·confirmed)은 값이 비어 있으면 안 된다. 값은 200자 이하.
        if jsonb_typeof(v_val->'value') is distinct from 'string'
           or char_length(v_val->>'value') > 200
           or (v_val->>'status' <> 'skipped' and btrim(v_val->>'value') = '') then
          return jsonb_build_object('outcome', 'bad_patch');
        end if;
        v_slots := v_slots || jsonb_build_object(v_key, v_val);
      end if;
    end loop;
  end if;
  v_extras := v_s.extras;
  if p_patch ? 'extras' then
    if jsonb_typeof(p_patch->'extras') <> 'array' or jsonb_array_length(p_patch->'extras') > 3 then
      return jsonb_build_object('outcome', 'bad_patch');
    end if;
    v_extras := p_patch->'extras';
  end if;
  v_counters := v_s.counters;
  if jsonb_typeof(p_patch->'asked') = 'array' then
    for v_key in select e.value #>> '{}' from jsonb_array_elements(p_patch->'asked') as e loop
      v_counters := jsonb_set(v_counters, array['asked', v_key], 'true'::jsonb, true);
    end loop;
  end if;
  if jsonb_typeof(p_patch->'reasked') = 'array' then
    for v_key in select e.value #>> '{}' from jsonb_array_elements(p_patch->'reasked') as e loop
      v_counters := jsonb_set(v_counters, array['reasked', v_key], '1'::jsonb, true);
    end loop;
  end if;
  v_pending := public.research_merge(v_s.pending, p_patch->'pending');

  v_changed := v_purchase <> v_s.purchase or v_slots <> v_s.slots or v_extras <> v_s.extras;
  v_version := v_s.version + case when v_changed then 1 else 0 end;
  v_review := v_s.review;
  if v_changed and v_review->>'status' = 'confirmed' then
    v_review := v_review || jsonb_build_object('status', 'draft',
      'rev', coalesce((v_review->>'rev')::int, 0) + 1);
  end if;

  update public.research_sessions as s
    set purchase = v_purchase, slots = v_slots, extras = v_extras, counters = v_counters,
        pending = v_pending, review = v_review, version = v_version, updated_at = now()
    where s.request_id = p_request_id
    returning s.* into v_n;

  -- 바뀐 상태에서 첫 유효 후보를 고른다.
  if jsonb_typeof(p_next) = 'array' then
    for v_cand in select e.value from jsonb_array_elements(p_next) as e loop
      if public.research_next_valid(v_n, v_cand) then v_chosen := v_cand; exit; end if;
    end loop;
  end if;

  v_all := case when jsonb_typeof(p_messages) = 'array' then p_messages else '[]'::jsonb end;
  if v_chosen is not null and jsonb_typeof(v_chosen->'message') = 'object' then
    v_all := v_all || jsonb_build_array(v_chosen->'message');
  end if;
  v_inserted := public.research_push_messages(p_request_id, v_all, p_client_turn_id);
  if jsonb_array_length(v_inserted) > 0 then
    v_first := (v_inserted->0->>'seq')::int;
    v_last := (v_inserted->(jsonb_array_length(v_inserted) - 1)->>'seq')::int;
  end if;

  if v_chosen is not null then
    v_action := v_chosen->>'action';
    v_slot := v_chosen->>'slot';
    v_counters := v_n.counters;
    v_pending := v_n.pending;
    if v_action in ('ask_slot', 'reask') then
      v_counters := jsonb_set(v_counters, array['asked', v_slot], 'true'::jsonb, true);
      if v_action = 'reask' then
        v_counters := jsonb_set(v_counters, array['reasked', v_slot], '1'::jsonb, true);
      end if;
      v_pending := public.research_merge(v_pending,
        jsonb_build_object('lastQuestion', jsonb_build_object('slot', v_slot, 'seq', v_last)));
    elsif v_action = 'ask_purchase' then
      v_pending := public.research_merge(v_pending,
        jsonb_build_object('lastQuestion', jsonb_build_object('slot', 'purchase', 'seq', v_last)));
    elsif v_action in ('ask_extra', 'propose_review') then
      v_pending := public.research_merge(v_pending,
        jsonb_build_object('lastQuestion', jsonb_build_object(
          'slot', case when v_action = 'ask_extra' then 'extra' else 'review' end, 'seq', v_last)));
    end if;
    update public.research_sessions as s set counters = v_counters, pending = v_pending
      where s.request_id = p_request_id;
  end if;

  v_resp := jsonb_build_object(
    'version', v_version, 'lastSeq', v_n.next_seq - 1 + jsonb_array_length(v_inserted),
    'messages', v_inserted, 'chosen', v_chosen->>'action',
    'session', public.research_view(p_request_id, 2147483647, false));
  if v_has_turn then
    update public.research_turns as t
      set first_seq = v_first, last_seq = v_last, response = v_resp
      where t.request_id = p_request_id and t.client_turn_id = p_client_turn_id;
  else
    insert into public.research_turns (request_id, client_turn_id, first_seq, last_seq, response)
      values (p_request_id, p_client_turn_id, v_first, v_last, v_resp);
  end if;
  return jsonb_build_object('outcome', 'ok', 'response', v_resp);
end;
$$;

-- ---------- 검색 결과 저장 ----------

-- p_cache_state: done(끝남 표시) | clear(표시 지움, 다시 시도 가능). p_pending는 research_merge로 합친다.
create or replace function public.research_add_message(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_cache_key text,
  p_messages jsonb, p_pending jsonb default null, p_cache_state text default 'done'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_guard text;
  v_s public.research_sessions%rowtype;
  v_inserted jsonb;
begin
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  v_inserted := public.research_push_messages(p_request_id, p_messages, null);
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  update public.research_sessions as s
    set pending = public.research_merge(s.pending, p_pending),
        search_cache = case
          when p_cache_key is null then s.search_cache
          when p_cache_state = 'clear' then s.search_cache - p_cache_key
          else s.search_cache || jsonb_build_object(p_cache_key,
            jsonb_build_object('state', 'done', 'at', extract(epoch from now())))
        end,
        updated_at = now()
    where s.request_id = p_request_id;
  return jsonb_build_object('outcome', 'ok', 'messages', v_inserted, 'lastSeq', v_s.next_seq - 1);
end;
$$;

-- ---------- 사진 ----------

-- 사진 하나를 넣고 photo 칸을 채운다. 확인 필요(pending)가 없고 직전 질문이 photo거나 없으면 p_next의 첫 유효 후보를 넣는다.
-- 사진 AI 설명(description·seen_model·shot)은 P2까지 null이다.
create or replace function public.research_add_photo(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_thumb text,
  p_description text, p_seen_model text, p_shot text,
  p_pending jsonb, p_messages jsonb, p_next jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_guard text;
  v_s public.research_sessions%rowtype;
  v_n public.research_sessions%rowtype;
  v_count int;
  v_photo_id uuid;
  v_last_slot text;
  v_cand jsonb;
  v_chosen jsonb := null;
  v_all jsonb;
  v_inserted jsonb;
  v_last int;
  v_action text;
  v_slot text;
  v_counters jsonb;
  v_pending jsonb;
  v_review jsonb;
begin
  if p_thumb is null or char_length(p_thumb) > 60000 or p_thumb !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then
    return jsonb_build_object('outcome', 'bad_request');
  end if;
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  if v_s.purchase = 'research' then return jsonb_build_object('outcome', 'photo_not_needed'); end if;
  select count(*) into v_count from public.research_photos as p where p.request_id = p_request_id;
  if v_count >= 3 then return jsonb_build_object('outcome', 'photos_full'); end if;
  insert into public.research_photos (request_id, thumb, description, seen_model, shot)
    values (p_request_id, p_thumb, p_description, p_seen_model, p_shot)
    returning id into v_photo_id;

  v_review := v_s.review;
  if v_review->>'status' = 'confirmed' then
    v_review := v_review || jsonb_build_object('status', 'draft', 'rev', coalesce((v_review->>'rev')::int, 0) + 1);
  end if;
  update public.research_sessions as s
    set slots = s.slots || jsonb_build_object('photo', jsonb_build_object(
          'value', (v_count + 1)::text || '장', 'status', 'filled', 'by', 'volunteer', 'at', now())),
        pending = public.research_merge(s.pending, p_pending),
        review = v_review, version = s.version + 1, updated_at = now()
    where s.request_id = p_request_id
    returning s.* into v_n;

  v_last_slot := v_n.pending->'lastQuestion'->>'slot';
  if jsonb_typeof(v_n.pending->'mismatch') is distinct from 'object'
     and jsonb_typeof(v_n.pending->'shotCheck') is distinct from 'object'
     and jsonb_typeof(v_n.pending->'confirmFill') is distinct from 'object'
     and (v_last_slot is null or v_last_slot = 'photo')
     and jsonb_typeof(p_next) = 'array' then
    for v_cand in select e.value from jsonb_array_elements(p_next) as e loop
      if public.research_next_valid(v_n, v_cand) then v_chosen := v_cand; exit; end if;
    end loop;
  end if;

  v_all := case when jsonb_typeof(p_messages) = 'array' then p_messages else '[]'::jsonb end;
  if v_chosen is not null and jsonb_typeof(v_chosen->'message') = 'object' then
    v_all := v_all || jsonb_build_array(v_chosen->'message');
  end if;
  v_inserted := public.research_push_messages(p_request_id, v_all, null);
  if v_chosen is not null then
    v_last := (v_inserted->(jsonb_array_length(v_inserted) - 1)->>'seq')::int;
    v_action := v_chosen->>'action';
    v_slot := v_chosen->>'slot';
    v_counters := v_n.counters;
    v_pending := v_n.pending;
    if v_action in ('ask_slot', 'reask') then
      v_counters := jsonb_set(v_counters, array['asked', v_slot], 'true'::jsonb, true);
      if v_action = 'reask' then
        v_counters := jsonb_set(v_counters, array['reasked', v_slot], '1'::jsonb, true);
      end if;
      v_pending := public.research_merge(v_pending,
        jsonb_build_object('lastQuestion', jsonb_build_object('slot', v_slot, 'seq', v_last)));
    elsif v_action = 'ask_purchase' then
      v_pending := public.research_merge(v_pending,
        jsonb_build_object('lastQuestion', jsonb_build_object('slot', 'purchase', 'seq', v_last)));
    elsif v_action in ('ask_extra', 'propose_review') then
      v_pending := public.research_merge(v_pending,
        jsonb_build_object('lastQuestion', jsonb_build_object(
          'slot', case when v_action = 'ask_extra' then 'extra' else 'review' end, 'seq', v_last)));
    end if;
    update public.research_sessions as s set counters = v_counters, pending = v_pending
      where s.request_id = p_request_id;
  end if;
  return jsonb_build_object('outcome', 'ok', 'photoId', v_photo_id, 'chosen', v_chosen->>'action',
    'messages', v_inserted, 'session', public.research_view(p_request_id, 2147483647, false));
end;
$$;

-- 사진 하나를 지운다. 요청 경로의 id와 request_id가 같은 행만 지운다. 0장이 되면 photo 칸을 비운다.
create or replace function public.research_remove_photo(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_photo_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_guard text;
  v_s public.research_sessions%rowtype;
  v_deleted uuid;
  v_left int;
  v_review jsonb;
begin
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  delete from public.research_photos as p
    where p.id = p_photo_id and p.request_id = p_request_id returning p.id into v_deleted;
  if v_deleted is null then return jsonb_build_object('outcome', 'photo_not_found'); end if;
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  select count(*) into v_left from public.research_photos as p where p.request_id = p_request_id;
  v_review := v_s.review;
  if v_review->>'status' = 'confirmed' then
    v_review := v_review || jsonb_build_object('status', 'draft', 'rev', coalesce((v_review->>'rev')::int, 0) + 1);
  end if;
  if v_left = 0 then
    update public.research_sessions as s
      set slots = s.slots - 'photo', pending = s.pending - 'mismatch' - 'shotCheck',
          review = v_review, version = s.version + 1, updated_at = now()
      where s.request_id = p_request_id;
  else
    update public.research_sessions as s
      set slots = s.slots || jsonb_build_object('photo', jsonb_build_object(
            'value', v_left::text || '장', 'status', 'filled', 'by', 'volunteer', 'at', now())),
          review = v_review, version = s.version + 1, updated_at = now()
      where s.request_id = p_request_id;
  end if;
  return jsonb_build_object('outcome', 'ok', 'session', public.research_view(p_request_id, 2147483647, false));
end;
$$;

-- ---------- 리뷰·보내기 ----------

-- p_review: {text, status: draft|confirmed}. confirmed는 p_base_version이 version과 같아야 한다.
create or replace function public.research_set_review(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_base_version int, p_review jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_guard text;
  v_s public.research_sessions%rowtype;
  v_status text := p_review->>'status';
  v_review jsonb;
begin
  if v_status not in ('draft', 'confirmed') or coalesce(p_review->>'text', '') = '' then
    return jsonb_build_object('outcome', 'bad_request');
  end if;
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  if v_status = 'confirmed' and (p_base_version is null or p_base_version <> v_s.version) then
    return jsonb_build_object('outcome', 'stale', 'version', v_s.version);
  end if;
  v_review := jsonb_build_object('text', p_review->>'text', 'status', v_status,
    'rev', coalesce((v_s.review->>'rev')::int, 0) + 1, 'at', now());
  if v_status = 'confirmed' then
    v_review := v_review || jsonb_build_object('confirmedVersion', v_s.version);
  end if;
  update public.research_sessions as s set review = v_review, updated_at = now()
    where s.request_id = p_request_id;
  return jsonb_build_object('outcome', 'ok', 'review', v_review);
end;
$$;

-- 결과를 보낸다. 이미 보낸 (요청, 봉사자)이면 existing. 요청을 done으로 바꾸면 트리거가 세션을 지운다.
-- 돌려주는 값 outcome: sent | existing | stale | missing_required(+missing) | review_not_confirmed | bad_request | 소유 오류
create or replace function public.research_send(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid,
  p_base_version int, p_review_rev int, p_candidates jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_sent timestamptz;
  v_guard text;
  v_s public.research_sessions%rowtype;
  v_missing text[];
  v_id uuid;
begin
  select res.sent_at into v_sent from public.results as res
    where res.request_id = p_request_id and res.volunteer_id = p_volunteer_id;
  if v_sent is not null then
    return jsonb_build_object('outcome', 'existing', 'sentAt', v_sent);
  end if;
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id, 'update');
  if v_guard <> 'ok' then
    -- 다른 탭이 방금 보냈으면(갱신이 겹친 경우) 그 결과를 돌려준다.
    select res.sent_at into v_sent from public.results as res
      where res.request_id = p_request_id and res.volunteer_id = p_volunteer_id;
    if v_sent is not null then return jsonb_build_object('outcome', 'existing', 'sentAt', v_sent); end if;
    return jsonb_build_object('outcome', v_guard);
  end if;
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  if p_base_version is null or p_base_version <> v_s.version then
    return jsonb_build_object('outcome', 'stale', 'version', v_s.version);
  end if;
  v_missing := public.research_required_missing(v_s);
  -- 구매함이면 칸 표시만이 아니라 실제 사진 행이 1장 이상 있어야 한다.
  if v_s.purchase = 'bought' and not ('photo' = any(v_missing))
     and not exists (select 1 from public.research_photos as p where p.request_id = p_request_id) then
    v_missing := array_append(v_missing, 'photo');
  end if;
  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('outcome', 'missing_required', 'missing', to_jsonb(v_missing));
  end if;
  if v_s.review->>'status' is distinct from 'confirmed'
     or (v_s.review->>'confirmedVersion')::int is distinct from v_s.version
     or (v_s.review->>'rev')::int is distinct from p_review_rev then
    return jsonb_build_object('outcome', 'review_not_confirmed');
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) not between 1 and 3 then
    return jsonb_build_object('outcome', 'bad_request');
  end if;
  update public.requests as r set status = 'done', done_at = now(), updated_at = now()
    where r.id = p_request_id and r.status = 'in_progress' and r.volunteer_id = p_volunteer_id
    returning r.id into v_id;
  if v_id is null then return jsonb_build_object('outcome', 'not_in_progress'); end if;
  insert into public.results as res (request_id, volunteer_id, candidates)
    values (p_request_id, p_volunteer_id, p_candidates) returning res.sent_at into v_sent;
  return jsonb_build_object('outcome', 'sent', 'sentAt', v_sent);
end;
$$;

-- ---------- 권한: 새 함수는 service_role만 부른다 ----------

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'research\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;
