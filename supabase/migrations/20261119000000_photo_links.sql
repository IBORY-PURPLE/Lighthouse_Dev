-- 봉사자 휴대폰 사진 링크(demo6 PR4, design.md 3.3·5.2 P1). 마이그레이션 2.
-- 노트북이 QR을 띄우고 휴대폰이 그 링크로 사진을 올린다. 휴대폰에는 봉사자 쿠키(lh_vol)가 없어서
-- "한 번만 쓰는 링크(10분) → 사진 올리기 전용 열쇠 grant(30분)" 두 단계로 권한을 준다.
-- 토큰·grant 원문은 어디에도 저장하지 않고 sha256(소문자 16진수 64자)만 저장한다.
-- 추가형이다. 기존 표·함수는 research_add_photo 하나만 바꾼다(아래). 잠금 순서는 requests → research_sessions → photo_links.
-- 되돌리기: supabase/rollback/20261119000000_photo_links_down.sql (사람이 실행).

create table public.photo_links (
  id uuid primary key default gen_random_uuid(),
  -- 세션이 지워지면(내려놓기·보내기·6시간 반환) 링크도 같이 지워진다.
  request_id uuid not null references public.research_sessions (request_id) on delete cascade,
  session_id uuid not null,
  volunteer_id text not null check (volunteer_id ~ '^(v-[0-9]{2}|d-[0-9a-f]{16})$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  -- 링크 만료 = 만든 뒤 10분.
  expires_at timestamptz not null,
  -- 휴대폰이 링크를 쓴(redeem) 시각. 한 번만 쓸 수 있다.
  used_at timestamptz,
  -- 사진 올리기 열쇠. 쓰면 30분.
  grant_hash text unique check (grant_hash is null or grant_hash ~ '^[0-9a-f]{64}$'),
  grant_expires_at timestamptz,
  revoked_at timestamptz,
  check ((grant_hash is null) = (grant_expires_at is null))
);
create index photo_links_request_idx on public.photo_links (request_id, created_at);

alter table public.photo_links enable row level security;
revoke all on table public.photo_links from anon, authenticated;
grant select, insert, update, delete on table public.photo_links to service_role;

-- ---------- 노트북 쪽 ----------

-- 새 링크를 만든다. 이 세션의 앞 링크(쓰지 않았거나 쓴 것 모두)는 끊는다. 사진이 필요 없거나 3장이 찼으면 만들지 않는다.
-- 돌려주는 값: ok{expiresAt} | photo_not_needed | photos_full | bad_request | not_found | not_in_progress | not_yours | session_changed
create or replace function public.photo_link_issue(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_token_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_guard text;
  v_s public.research_sessions%rowtype;
  v_count int;
  v_expires timestamptz;
begin
  if p_session_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'bad_request');
  end if;
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  if v_s.purchase = 'research' then return jsonb_build_object('outcome', 'photo_not_needed'); end if;
  select count(*) into v_count from public.research_photos as p where p.request_id = p_request_id;
  if v_count >= 3 then return jsonb_build_object('outcome', 'photos_full'); end if;
  update public.photo_links as l set revoked_at = now()
    where l.request_id = p_request_id and l.revoked_at is null;
  v_expires := now() + interval '10 minutes';
  insert into public.photo_links (request_id, session_id, volunteer_id, token_hash, expires_at)
    values (p_request_id, p_session_id, p_volunteer_id, p_token_hash, v_expires);
  return jsonb_build_object('outcome', 'ok', 'expiresAt', v_expires);
end;
$$;

-- 이 세션의 링크를 모두 끊는다(앞서 쓴 grant도 함께).
create or replace function public.photo_link_revoke(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_guard text;
  v_count int;
begin
  if p_session_id is null then return jsonb_build_object('outcome', 'bad_request'); end if;
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  update public.photo_links as l set revoked_at = now()
    where l.request_id = p_request_id and l.revoked_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('outcome', 'ok', 'revoked', v_count);
end;
$$;

-- 노트북 화면이 읽는 링크 상태. 쓰기도 잠금도 없다. 이 봉사자·이 세션의 가장 최근 링크 하나만 본다.
-- state: none(없음·끊김) | waiting(링크를 만들었고 아직 안 씀) | connected(휴대폰이 연결됐고 grant가 살아 있음) | expired(시간이 지남)
create or replace function public.photo_link_state(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_l public.photo_links%rowtype;
begin
  select l.* into v_l from public.photo_links as l
    where l.request_id = p_request_id and l.volunteer_id = p_volunteer_id and l.session_id = p_session_id
      and l.revoked_at is null
    order by l.created_at desc, l.id limit 1;
  if not found then
    return jsonb_build_object('outcome', 'ok', 'state', 'none', 'expiresAt', null);
  end if;
  if v_l.used_at is null then
    if v_l.expires_at > now() then
      return jsonb_build_object('outcome', 'ok', 'state', 'waiting', 'expiresAt', v_l.expires_at);
    end if;
    return jsonb_build_object('outcome', 'ok', 'state', 'expired', 'expiresAt', v_l.expires_at);
  end if;
  if v_l.grant_expires_at > now() then
    return jsonb_build_object('outcome', 'ok', 'state', 'connected', 'expiresAt', v_l.grant_expires_at);
  end if;
  return jsonb_build_object('outcome', 'ok', 'state', 'expired', 'expiresAt', v_l.grant_expires_at);
end;
$$;

-- ---------- 휴대폰 쪽 ----------

-- 링크를 쓴다. 한 번만 된다(두 번째는 gone). 같은 세션의 다른 grant는 끊는다.
-- 링크의 봉사자가 여전히 이 요청을 in_progress로 맡고 있고 세션이 그대로일 때만 된다.
-- 돌려주는 값: ok{grantExpiresAt} | gone(없음·만료·이미 씀·끊김·요청을 떠남) | bad_request
create or replace function public.photo_link_redeem(
  p_token_hash text, p_grant_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_pre public.photo_links%rowtype;
  v_l public.photo_links%rowtype;
  v_guard text;
  v_grant_expires timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_grant_hash is null or p_grant_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'bad_request');
  end if;
  select l.* into v_pre from public.photo_links as l where l.token_hash = p_token_hash;
  if not found then return jsonb_build_object('outcome', 'gone'); end if;
  -- 요청 → 세션 순서로 잠근다(다른 함수와 같은 순서). 링크 행은 그다음.
  v_guard := public.research_guard(v_pre.request_id, v_pre.volunteer_id, v_pre.session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', 'gone'); end if;
  select l.* into v_l from public.photo_links as l where l.id = v_pre.id for update;
  if not found or v_l.revoked_at is not null or v_l.used_at is not null or v_l.expires_at <= now() then
    return jsonb_build_object('outcome', 'gone');
  end if;
  v_grant_expires := now() + interval '30 minutes';
  update public.photo_links as l
    set used_at = now(), grant_hash = p_grant_hash, grant_expires_at = v_grant_expires
    where l.id = v_l.id;
  update public.photo_links as l set revoked_at = now()
    where l.request_id = v_l.request_id and l.id <> v_l.id and l.revoked_at is null;
  return jsonb_build_object('outcome', 'ok', 'grantExpiresAt', v_grant_expires);
end;
$$;

-- grant가 아직 살아 있는지 본다(휴대폰 화면과 올리기 라우트의 첫 확인). 잠그지 않는다. 진짜 확인은 research_add_photo가 잠근 안에서 한다.
-- 돌려주는 값: ok{requestId, volunteerId, sessionId, expiresAt} | gone
create or replace function public.photo_link_check(
  p_grant_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_l public.photo_links%rowtype;
  v_found boolean;
begin
  if p_grant_hash is null or p_grant_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'gone');
  end if;
  select l.* into v_l from public.photo_links as l
    where l.grant_hash = p_grant_hash and l.used_at is not null and l.revoked_at is null
      and l.grant_expires_at > now()
      and exists (
        select 1 from public.research_sessions as s
          join public.requests as r on r.id = s.request_id
          where s.request_id = l.request_id and s.session_id = l.session_id
            and s.volunteer_id = l.volunteer_id
            and r.status = 'in_progress' and r.volunteer_id = l.volunteer_id);
  v_found := found;
  if not v_found then return jsonb_build_object('outcome', 'gone'); end if;
  return jsonb_build_object('outcome', 'ok', 'requestId', v_l.request_id, 'volunteerId', v_l.volunteer_id,
    'sessionId', v_l.session_id, 'expiresAt', v_l.grant_expires_at);
end;
$$;

-- ---------- 사진 넣기: grant와 session_id를 잠근 안에서 다시 확인 ----------

-- 20261117000000의 research_add_photo(인자 10개)를 인자 11개(p_grant_hash, 기본 null)로 바꾼다.
-- p_grant_hash가 null이면 노트북 올리기(lh_vol이 소유를 증명)라 지금까지와 똑같이 동작한다.
-- 값이 있으면 휴대폰 올리기라, 잠금을 쥔 뒤 "이 요청·이 세션·이 봉사자의 살아 있는(끊기지 않은, 만료 전) grant"가 맞는지 다시 확인하고
-- 아니면 grant_gone을 돌려준다. p_session_id가 null이면 grant 올리기는 거절한다(세션 대조를 건너뛰지 못하게).
drop function public.research_add_photo(uuid, text, uuid, text, text, text, text, jsonb, jsonb, jsonb);

create or replace function public.research_add_photo(
  p_request_id uuid, p_volunteer_id text, p_session_id uuid, p_thumb text,
  p_description text, p_seen_model text, p_shot text,
  p_pending jsonb, p_messages jsonb, p_next jsonb,
  p_grant_hash text default null
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
  if p_grant_hash is not null and p_session_id is null then
    return jsonb_build_object('outcome', 'grant_gone');
  end if;
  v_guard := public.research_guard(p_request_id, p_volunteer_id, p_session_id);
  if v_guard <> 'ok' then return jsonb_build_object('outcome', v_guard); end if;
  if p_grant_hash is not null and not exists (
    select 1 from public.photo_links as l
      where l.request_id = p_request_id and l.session_id = p_session_id and l.volunteer_id = p_volunteer_id
        and l.grant_hash = p_grant_hash and l.used_at is not null
        and l.revoked_at is null and l.grant_expires_at > now()
  ) then
    return jsonb_build_object('outcome', 'grant_gone');
  end if;
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

-- ---------- 권한: 새 함수와 바뀐 함수는 service_role만 부른다 ----------

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (p.proname like 'photo\_link\_%' or p.proname = 'research_add_photo')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;
