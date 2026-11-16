set local lock_timeout = '3s';

-- 리서치 챗 대화형(demo5) 블록 A1b: 대화 글 보관(30일)과 리뷰 영구 저장. 이용자 결정 A45(2026-11-16).
-- 추가형이다. 마이그레이션 1(20261117000000)의 표·함수는 파일을 고치지 않고 research_send·research_sweep만
-- 같은 시그니처로 create or replace 한다(오버로드를 만들지 않는다). 기존 함수 5개는 바꾸지 않는다.
-- 두 표는 requests를 참조하지 않는다(FK 없음): 요청이 done 7일 정리나 시연 다시 채우기로 지워져도 남는다.

-- 보낼 때 대화를 글로만 복사한 것. AI가 올바른 질문을 하도록 다듬는 자료(RAG)로 쓴다. 30일 뒤 research_sweep이 지운다.
-- 사진·썸네일·data URL은 넣지 않는다. 개인 연락처 열은 requests에도 없다.
create table public.research_archives (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  is_demo boolean not null default false,
  -- 품목·브랜드·요청 문장 등 requests에서 복사한 값
  request jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request) = 'object' and octet_length(request::text) <= 8000),
  purchase text not null default 'unset' check (purchase in ('unset', 'bought', 'research')),
  verified boolean not null default false,
  -- 최종 칸. 사진 썸네일·data URL은 빼고 복사한다(research_strip_data).
  slots jsonb not null default '{}'::jsonb
    check (jsonb_typeof(slots) = 'object' and octet_length(slots::text) <= 30000),
  -- [{seq, role, tag, slot, text}] seq 순서. 글만 있다. research_archive_messages가 200KB 안으로 줄여 담는다.
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array' and octet_length(messages::text) <= 204800),
  -- {final, draft, rev}
  review jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review) = 'object' and octet_length(review::text) <= 30000)
);
create index research_archives_created_at_idx on public.research_archives (created_at);

-- 봉사자가 검수해 보낸 리뷰. 영구 보관이다(삭제 규칙 없음). 나중에 같은 품목을 듣고 싶은 이용자에게 바로 전하는 데 다시 쓴다.
create table public.research_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  is_demo boolean not null default false,
  item text,
  brand text,
  product text,
  model text,
  purchase text not null default 'unset' check (purchase in ('unset', 'bought', 'research')),
  verified boolean not null default false,
  review_text text not null check (char_length(review_text) between 1 and 1000),
  -- 같이 고민한 제품 이름 ["…", "…"]
  alts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(alts) = 'array' and octet_length(alts::text) <= 2000),
  -- 봉사자가 [확인했어요]한 혜택 [{title, url, kind, condition, confirmedAt}]
  benefit_links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(benefit_links) = 'array' and octet_length(benefit_links::text) <= 8000),
  sent_at timestamptz not null default now()
);
create index research_reviews_item_idx on public.research_reviews (item, brand);

alter table public.research_archives enable row level security;
alter table public.research_reviews enable row level security;
revoke all on table public.research_archives, public.research_reviews from anon, authenticated;
grant select, insert, update, delete on table public.research_archives, public.research_reviews
  to service_role;

-- ---------- 보조 함수(research_send 안에서만 쓴다. 호출자의 잠금 안에서 돈다) ----------

-- jsonb 안의 "data:" 문자열 값과 thumb 키를 지운다(사진 썸네일이 보관본에 들어가지 않게).
create or replace function public.research_strip_data(p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_out jsonb;
  v_key text;
  v_val jsonb;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      v_out := '{}'::jsonb;
      for v_key, v_val in select e.key, e.value from jsonb_each(p_value) as e loop
        if v_key = 'thumb' then continue; end if;
        if jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') ~* '^\s*data:' then continue; end if;
        v_out := v_out || jsonb_build_object(v_key, public.research_strip_data(v_val));
      end loop;
      return v_out;
    when 'array' then
      select coalesce(jsonb_agg(public.research_strip_data(e.value) order by e.ord), '[]'::jsonb) into v_out
        from jsonb_array_elements(p_value) with ordinality as e(value, ord)
        where not (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~* '^\s*data:');
      return v_out;
    else
      return p_value;
  end case;
end;
$$;

-- 메시지 body에서 "글이 되는 부분"만 뽑는다. 사진(kind photo)·빠른 답·칩은 글이 아니라 뺀다.
-- text·headline, 제품 카드(이름·특징·주소), 혜택 카드(제목·종류·조건·비교·주소), 링크, 찾는 방법 세 부분.
create or replace function public.research_body_text(p_body jsonb)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_body jsonb;
  v_kind text;
  v_lines text[] := '{}';
  v_item jsonb;
  v_part text;
  v_key text;
  v_label text;
  v_vals text;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' then return ''; end if;
  v_kind := p_body->>'kind';
  if v_kind = 'photo' then return ''; end if;
  v_body := public.research_strip_data(p_body);
  if jsonb_typeof(v_body->'headline') = 'string' then v_lines := v_lines || (v_body->>'headline'); end if;
  if jsonb_typeof(v_body->'text') = 'string' then v_lines := v_lines || (v_body->>'text'); end if;
  if v_kind in ('products', 'benefits') and jsonb_typeof(v_body->'items') = 'array' then
    for v_item in select e.value from jsonb_array_elements(v_body->'items') as e loop
      continue when jsonb_typeof(v_item) <> 'object';
      if v_kind = 'products' then
        v_part := concat_ws(' - ', nullif(v_item->>'name', ''), nullif(v_item->>'feature', ''),
          nullif(v_item->>'pageUrl', ''));
      else
        v_part := concat_ws(' - ', nullif(v_item->>'title', ''), nullif(v_item->>'kind', ''),
          nullif(v_item->>'condition', ''), nullif(v_item->>'compare', ''), nullif(v_item->>'url', ''));
      end if;
      if v_part <> '' then v_lines := v_lines || v_part; end if;
    end loop;
  elsif v_kind = 'link' then
    v_part := concat_ws(' - ', nullif(v_body->>'url', ''), nullif(v_body->>'note', ''));
    if v_part <> '' then v_lines := v_lines || v_part; end if;
  elsif v_kind = 'guide' then
    foreach v_key in array array['queries', 'checks', 'steps'] loop
      v_label := case v_key when 'queries' then '검색어' when 'checks' then '확인할 조건' else '찾는 순서' end;
      if jsonb_typeof(v_body->v_key) = 'array' then
        select string_agg(e.value #>> '{}', ', ' order by e.ord) into v_vals
          from jsonb_array_elements(v_body->v_key) with ordinality as e(value, ord)
          where jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') <> '';
        if v_vals is not null then v_lines := v_lines || (v_label || ': ' || v_vals); end if;
      end if;
    end loop;
  end if;
  return array_to_string(v_lines, E'\n');
end;
$$;

-- 한 요청의 대화를 seq 순서로 [{seq, role, tag, slot, text}] 글만 뽑는다. 사진 말풍선·글이 없는 메시지는 건너뛴다.
-- 메시지마다 3,000자로 자르고, 합계(jsonb 글자 크기)가 190KB를 넘으면 거기서 멈춘다(보관 표의 200KB 검사를 넘지 않게).
create or replace function public.research_archive_messages(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_bytes int := 2;
  v_m record;
  v_text text;
  v_item jsonb;
begin
  for v_m in
    select m.seq, m.role, m.tag, m.slot, m.body from public.research_messages as m
      where m.request_id = p_request_id order by m.seq
  loop
    v_text := regexp_replace(public.research_body_text(v_m.body),
      'data:[A-Za-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+', '', 'g');
    v_text := regexp_replace(left(v_text, 3000), '^\s+|\s+$', '', 'g');
    continue when v_text = '';
    v_item := jsonb_build_object('seq', v_m.seq, 'role', v_m.role, 'tag', v_m.tag, 'slot', v_m.slot, 'text', v_text);
    exit when v_bytes + octet_length(v_item::text) + 2 > 190000;
    v_bytes := v_bytes + octet_length(v_item::text) + 2;
    v_out := v_out || jsonb_build_array(v_item);
  end loop;
  return v_out;
end;
$$;

-- 보내는 순간 두 표에 넣는다. research_send가 요청을 done으로 바꾸기 전에 부른다(그 UPDATE가 트리거로 세션을 지운다).
-- request_id가 같은 행이 있으면 건드리지 않는다. p_candidates는 보내는 결과(후보 1~3개): 2·3번째 이름이 같이 고민한 제품이다.
create or replace function public.research_archive_put(p_request_id uuid, p_candidates jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_s public.research_sessions%rowtype;
  v_r public.requests%rowtype;
  v_verified boolean;
  v_model text;
  v_final text;
  v_draft text;
  v_alts jsonb;
  v_links jsonb;
begin
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  if not found then return; end if;
  select r.* into v_r from public.requests as r where r.id = p_request_id;
  if not found then return; end if;

  v_verified := v_s.purchase = 'bought'
    and exists (select 1 from public.research_photos as p where p.request_id = p_request_id);
  v_final := regexp_replace(left(coalesce(v_s.review->>'text', ''), 1000), '^\s+|\s+$', '', 'g');
  -- 초안 = AI가 마지막으로 제안한 리뷰 메시지(없으면 null)
  select left(public.research_body_text(m.body), 2500) into v_draft
    from public.research_messages as m
    where m.request_id = p_request_id and m.role = 'ai' and m.tag = 'review'
    order by m.seq desc limit 1;
  v_model := left(coalesce(nullif(btrim(v_s.slots->'model'->>'value'), ''), p_candidates->0->>'name', ''), 200);

  select coalesce(jsonb_agg(left(e.value->>'name', 100) order by e.ord), '[]'::jsonb) into v_alts
    from jsonb_array_elements(p_candidates) with ordinality as e(value, ord)
    where e.ord > 1 and jsonb_typeof(e.value) = 'object' and coalesce(e.value->>'name', '') <> '';

  -- 봉사자가 [확인했어요]한 혜택 주소(slots.benefits.links)에 혜택 카드의 제목·종류·조건을 이어 붙인다.
  select coalesce(jsonb_agg(jsonb_build_object(
      'title', left(coalesce(i.item->>'title', ''), 60),
      'url', left(l.url, 500),
      'kind', left(coalesce(i.item->>'kind', ''), 40),
      'condition', left(coalesce(i.item->>'condition', ''), 80),
      'confirmedAt', coalesce(v_s.slots->'benefits'->>'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    ) order by l.ord), '[]'::jsonb) into v_links
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_s.slots->'benefits'->'links') = 'array' then v_s.slots->'benefits'->'links' else '[]'::jsonb end
    ) with ordinality as l(url, ord)
    left join lateral (
      select it.value as item
        from public.research_messages as m
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(m.body->'items') = 'array' then m.body->'items' else '[]'::jsonb end) as it
        where m.request_id = p_request_id and m.body->>'kind' = 'benefits'
          and jsonb_typeof(it.value) = 'object' and it.value->>'url' = l.url
        order by m.seq desc limit 1
    ) as i on true
    where l.ord <= 10 and l.url ~ '^https?://';

  insert into public.research_archives (request_id, is_demo, request, purchase, verified, slots, messages, review)
    values (p_request_id, v_r.is_demo,
      jsonb_strip_nulls(jsonb_build_object('product', v_r.product, 'budget', v_r.budget, 'condition', v_r.condition,
        'brand', v_r.brand, 'item', v_r.item, 'conditionKind', v_r.condition_kind)),
      v_s.purchase, v_verified, public.research_strip_data(v_s.slots),
      public.research_archive_messages(p_request_id),
      jsonb_build_object('final', v_final, 'draft', v_draft, 'rev', coalesce((v_s.review->>'rev')::int, 0)))
    on conflict (request_id) do nothing;

  -- 리뷰 문단이 비어 있으면(검수 규칙상 없지만) 영구 표에는 넣지 않는다.
  if v_final <> '' then
    insert into public.research_reviews (request_id, is_demo, item, brand, product, model, purchase, verified,
      review_text, alts, benefit_links)
      values (p_request_id, v_r.is_demo, v_r.item, v_r.brand, v_r.product, nullif(v_model, ''), v_s.purchase,
        v_verified, v_final, v_alts, v_links)
      on conflict (request_id) do nothing;
  end if;
end;
$$;

-- ---------- 같은 시그니처로 바꾸는 함수 2개 ----------

-- 결과를 보낸다. 마이그레이션 1의 본문에 보관 표 넣기(research_archive_put)를 더했다.
-- 이미 보낸 요청의 재전송(existing 경로)에서는 넣지 않는다. 돌려주는 값은 마이그레이션 1과 같다.
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
  -- 요청을 done으로 바꾸면 트리거가 세션을 지우므로, 그 전에 같은 트랜잭션에서 대화 글과 리뷰를 보관 표에 넣는다.
  perform public.research_archive_put(p_request_id, p_candidates);
  update public.requests as r set status = 'done', done_at = now(), updated_at = now()
    where r.id = p_request_id and r.status = 'in_progress' and r.volunteer_id = p_volunteer_id
    returning r.id into v_id;
  if v_id is null then
    delete from public.research_archives as a where a.request_id = p_request_id;
    delete from public.research_reviews as rv where rv.request_id = p_request_id;
    return jsonb_build_object('outcome', 'not_in_progress');
  end if;
  insert into public.results as res (request_id, volunteer_id, candidates)
    values (p_request_id, p_volunteer_id, p_candidates) returning res.sent_at into v_sent;
  return jsonb_build_object('outcome', 'sent', 'sentAt', v_sent);
end;
$$;

-- 6시간 정리(마이그레이션 1과 같다) + 30일 지난 research_archives 삭제. 돌려주는 값은 대기열로 돌린 요청 수 그대로다.
create or replace function public.research_sweep(p_idle interval default interval '6 hours')
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_ids uuid[];
  v_count int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('lighthouse.research_sweep')) then return 0; end if;
  -- 보관 30일이 지난 대화 글 복사본을 지운다. research_reviews는 영구 보관이라 지우지 않는다.
  delete from public.research_archives as a where a.created_at < now() - interval '30 days';
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

-- ---------- 권한: 새·바뀐 함수는 service_role만 부른다(마이그레이션 1과 같은 규칙) ----------

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('research_strip_data', 'research_body_text', 'research_archive_messages',
          'research_archive_put', 'research_send', 'research_sweep')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;
