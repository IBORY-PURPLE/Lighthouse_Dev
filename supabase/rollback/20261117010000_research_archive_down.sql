-- 20261117010000_research_archive.sql 되돌리기. 사람이 실행한다(supabase/migrations 밖이라 자동으로 돌지 않는다).
-- 이 파일 전체를 한 번에 실행한 뒤, `supabase migration repair --status reverted 20261117010000 --linked`도 실행해야 나중에 다시 적용할 수 있다.
-- research_send·research_sweep은 마이그레이션 1(20261117000000)의 본문으로 되돌린다(보관 표 넣기·30일 삭제가 빠진다).
-- research_archives·research_reviews 표와 그 안의 데이터(영구 보관 리뷰 포함)는 사라진다. 필요하면 먼저 내려받는다.

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

drop function if exists public.research_archive_put(uuid, jsonb);
drop function if exists public.research_archive_messages(uuid);
drop function if exists public.research_body_text(jsonb);
drop function if exists public.research_strip_data(jsonb);
drop function if exists public.research_final_review(jsonb, jsonb);
drop function if exists public.research_scrub_text(text);
drop function if exists public.research_scrub_plain(text);
drop function if exists public.research_url_decode(text);

drop table if exists public.research_reviews;
drop table if exists public.research_archives;
