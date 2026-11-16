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
comment on table public.research_reviews is
  '영구 보관. 재사용 조회는 반드시 is_demo = false로 거른다(시연·리허설 리뷰가 섞여 있다). 개인정보가 들어갔으면 service_role로 request_id 행을 지운다(TSD 8.3).';
comment on table public.research_archives is
  '보낸 날부터 30일(research_sweep이 지움). 시연 행(is_demo)이 섞여 있다. 자료로 쓸 때 is_demo = false로 거른다.';

alter table public.research_archives enable row level security;
alter table public.research_reviews enable row level security;
revoke all on table public.research_archives, public.research_reviews from anon, authenticated;
grant select, insert, update, delete on table public.research_archives, public.research_reviews
  to service_role;

-- ---------- 보조 함수(research_send 안에서만 쓴다. 호출자의 잠금 안에서 돈다) ----------

-- 주소 안의 %XX(ASCII 0x01~0x7F)를 글자로 푼다. %2540처럼 여러 번 감싼 것도 더 바뀌지 않을 때까지(최대 20번) 푼다. 연락처를 %40·%2B로 숨긴 주소를 가려내는 데 쓴다.
create or replace function public.research_url_decode(p_text text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare
  v text := p_text;
  v_prev text;
  v_pass int;
begin
  if v is null then return null; end if;
  for v_pass in 1..20 loop
    exit when v !~ '%[0-7][0-9A-Fa-f]';
    v_prev := v;
    select string_agg(
        case when t.m[1] ~ '^%[0-7][0-9A-Fa-f]$' and t.m[1] <> '%00'
          then chr(get_byte(decode(substr(t.m[1], 2), 'hex'), 0)) else t.m[1] end, '' order by t.ord)
      into v from regexp_matches(v, '(%[0-7][0-9A-Fa-f]|[^%]+|%)', 'g') with ordinality as t(m, ord);
    exit when v = v_prev;
  end loop;
  return v;
end;
$$;

-- 주소를 따로 보지 않고 글자만 가린다: data URL은 빈 글, 이메일·주민등록번호(하이픈형)·카드번호(4자리 4묶음)·전화번호는
-- [이메일]·[주민번호]·[카드번호]·[전화번호]로 바꾼다. 집 주소나 말로 받아 적은 번호는 가리지 못한다(남는 위험, TSD 8.3).
create or replace function public.research_scrub_plain(p_text text)
returns text language sql immutable security invoker set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(p_text,
    'data:[A-Za-z0-9.+/-]*(;[A-Za-z0-9=._+-]+)*,[^\s"'')]+', '', 'gi'),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[이메일]', 'g'),
    '(?<![0-9])[0-9]{6}-[1-4][0-9]{6}(?![0-9])', '[주민번호]', 'g'),
    '(?<![0-9])[0-9]{4}([- ]?)[0-9]{4}\1[0-9]{4}\1[0-9]{4}(?![0-9])', '[카드번호]', 'g'),
    '(?<![0-9])(?:\+82[- ]?0?|0)[0-9]{1,2}[- .]?[0-9]{3,4}[- .]?[0-9]{4}(?![0-9])', '[전화번호]', 'g')
$$;

-- 보관할 글에서 사진 데이터(data URL), 이메일, 전화번호를 지운다(data URL은 빈 글, 나머지는 [이메일]·[전화번호]로 바꾼다).
-- 1) 글 속 http(s) 주소(공백 전까지 전부)에 연락처·data URL이 섞여 있으면 가리면 깨지므로 주소 전체를 뺀다.
--    %40처럼 인코딩된 것도 푼 뒤 보고, 20번을 풀어도 %XX가 남으면(여러 겹으로 숨김) 뺀다.
-- 2) http가 아닌 덩어리(공백 사이)도 %XX를 풀면 연락처·data URL이 나오면 그 덩어리를 뺀다.
-- 대화 글 30일 보관본과 영구 리뷰에 사진 조각이나 연락처가 남지 않게 하는 마지막 안전망이다.
create or replace function public.research_scrub_text(p_text text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_out text := '';
  v_out2 text := '';
  v_tok text[];
  v_dec text;
begin
  if p_text is null then return null; end if;
  for v_tok in
    select m from regexp_matches(p_text,
      '([hH][tT][tT][pP][sS]?://[^ \t\n\r\f\v]+)|([^hH]+|[hH])', 'g') as m
  loop
    if v_tok[1] is not null then
      v_dec := public.research_url_decode(v_tok[1]);
      -- 20번을 풀어도 %XX가 남는 주소(여러 겹으로 숨긴 것)도 뺀다.
      if public.research_scrub_plain(v_tok[1]) <> v_tok[1] or public.research_scrub_plain(v_dec) <> v_dec
         or v_dec ~ '%(0[1-9A-Fa-f]|[1-7][0-9A-Fa-f])' then
        continue;
      end if;
      v_out := v_out || v_tok[1];
    else
      v_out := v_out || v_tok[2];
    end if;
  end loop;
  for v_tok in
    select m from regexp_matches(v_out, '([^ \t\n\r\f\v]+)|([ \t\n\r\f\v]+)', 'g') as m
  loop
    if v_tok[1] is not null then
      v_dec := public.research_url_decode(v_tok[1]);
      -- 20번을 풀어도 %XX가 남는 덩어리(여러 겹으로 숨긴 것)도 뺀다.
      if v_dec <> v_tok[1] and (public.research_scrub_plain(v_dec) <> v_dec
         or v_dec ~ '%(0[1-9A-Fa-f]|[1-7][0-9A-Fa-f])') then
        continue;
      end if;
      v_out2 := v_out2 || v_tok[1];
    else
      v_out2 := v_out2 || v_tok[2];
    end if;
  end loop;
  return public.research_scrub_plain(v_out2);
end;
$$;

-- jsonb 안의 "data:" 문자열 값과 thumb 키를 지우고, 나머지 글은 research_scrub_text로 가린다(사진 썸네일이 보관본에 들어가지 않게).
-- 가리면 깨지는 주소(http로 시작하는데 전화번호·이메일·data URL이 섞인 값)는 값 자체를 뺀다.
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
        if jsonb_typeof(v_val) = 'string' and (
             (v_val #>> '{}') ~* '^\s*data:'
             or ((v_val #>> '{}') ~* '^https?://' and public.research_scrub_text(v_val #>> '{}') <> (v_val #>> '{}'))
           ) then continue; end if;
        v_out := v_out || jsonb_build_object(v_key, public.research_strip_data(v_val));
      end loop;
      return v_out;
    when 'array' then
      select coalesce(jsonb_agg(public.research_strip_data(e.value) order by e.ord), '[]'::jsonb) into v_out
        from jsonb_array_elements(p_value) with ordinality as e(value, ord)
        where not (jsonb_typeof(e.value) = 'string' and (
          (e.value #>> '{}') ~* '^\s*data:'
          or ((e.value #>> '{}') ~* '^https?://' and public.research_scrub_text(e.value #>> '{}') <> (e.value #>> '{}'))));
      return v_out;
    when 'string' then
      return to_jsonb(public.research_scrub_text(p_value #>> '{}'));
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

-- 영구 리뷰에 들어갈 최종 문단. 세션 리뷰(confirmed)를 쓰고, 공백뿐이면(set_review는 빈 글만 막는다)
-- 보내는 결과의 후보 1 가이드(= 리뷰 문단)를 쓴다. 가려야 할 글은 가리고 1,000자로 자른다. 둘 다 비면 빈 글.
create or replace function public.research_final_review(p_review jsonb, p_candidates jsonb)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_final text;
begin
  v_final := regexp_replace(public.research_scrub_text(left(coalesce(p_review->>'text', ''), 1000)), '^\s+|\s+$', '', 'g');
  if v_final = '' and jsonb_typeof(p_candidates) = 'array' then
    v_final := regexp_replace(public.research_scrub_text(left(coalesce(p_candidates->0->>'guide', ''), 1000)), '^\s+|\s+$', '', 'g');
  end if;
  return v_final;
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
    v_text := public.research_scrub_text(public.research_body_text(v_m.body));
    v_text := regexp_replace(left(v_text, 3000), '^\s+|\s+$', '', 'g');
    continue when v_text = '';
    v_item := jsonb_build_object('seq', v_m.seq, 'role', v_m.role, 'tag', public.research_scrub_text(v_m.tag),
      'slot', public.research_scrub_text(v_m.slot), 'text', v_text);
    exit when v_bytes + octet_length(v_item::text) + 2 > 190000;
    v_bytes := v_bytes + octet_length(v_item::text) + 2;
    v_out := v_out || jsonb_build_array(v_item);
  end loop;
  return v_out;
end;
$$;

-- 보내는 순간 두 표에 넣는다. research_send가 요청을 done으로 바꾸기 전에 부른다(그 UPDATE가 트리거로 세션을 지운다).
-- 보관은 보내기를 막지 않는다(크기를 줄여 담고, 그래도 검사에 걸리면 그 표만 건너뛴다). request_id가 같은 행이 있으면 건드리지 않는다. p_candidates는 보내는 결과(후보 1~3개): 2·3번째 이름이 같이 고민한 제품이다.
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
  v_slots jsonb;
begin
  select s.* into v_s from public.research_sessions as s where s.request_id = p_request_id;
  if not found then return; end if;
  select r.* into v_r from public.requests as r where r.id = p_request_id;
  if not found then return; end if;

  v_verified := v_s.purchase = 'bought'
    and exists (select 1 from public.research_photos as p where p.request_id = p_request_id);
  v_final := public.research_final_review(v_s.review, p_candidates);
  -- 초안 = AI가 마지막으로 제안한 리뷰 메시지(없으면 null)
  select left(public.research_scrub_text(public.research_body_text(m.body)), 2500) into v_draft
    from public.research_messages as m
    where m.request_id = p_request_id and m.role = 'ai' and m.tag = 'review'
    order by m.seq desc limit 1;
  v_model := left(public.research_scrub_text(
    coalesce(nullif(btrim(v_s.slots->'model'->>'value'), ''), p_candidates->0->>'name', '')), 200);

  select coalesce(jsonb_agg(left(public.research_scrub_text(e.value->>'name'), 100) order by e.ord), '[]'::jsonb) into v_alts
    from jsonb_array_elements(p_candidates) with ordinality as e(value, ord)
    where e.ord > 1 and jsonb_typeof(e.value) = 'object' and coalesce(e.value->>'name', '') <> '';

  -- 봉사자가 [확인했어요]한 혜택 주소(slots.benefits.links)에 혜택 카드의 제목·종류·조건을 이어 붙인다.
  select coalesce(jsonb_agg(jsonb_build_object(
      'title', left(public.research_scrub_text(coalesce(i.item->>'title', '')), 60),
      'url', left(l.url, 500),
      'kind', left(public.research_scrub_text(coalesce(i.item->>'kind', '')), 40),
      'condition', left(public.research_scrub_text(coalesce(i.item->>'condition', '')), 80),
      'confirmedAt', left(public.research_scrub_text(
        coalesce(v_s.slots->'benefits'->>'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))), 40)
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
    -- 주소에 전화번호·이메일·data URL이 섞여 있으면(가리면 주소가 깨지므로) 그 링크는 영구 기록에 넣지 않는다.
    where l.ord <= 4 and l.url ~ '^https?://' and public.research_scrub_text(l.url) = l.url;
  -- 보관은 보내기를 막지 않는다: 영구 표의 크기 검사(8,000바이트)에 걸리지 않게 뒤에서부터 덜어 낸다. 개수 상한은 앱(maxLinks)과 같은 4개.
  while jsonb_array_length(v_links) > 0 and octet_length(v_links::text) > 7500 loop
    v_links := v_links - (jsonb_array_length(v_links) - 1);
  end loop;
  -- 칸은 가리면서 글자가 늘 수 있다(전화번호 11자 -> [전화번호]). 보관 표 검사(30,000바이트)를 넘으면 칸은 비워 둔다.
  v_slots := public.research_strip_data(v_s.slots);
  if octet_length(v_slots::text) > 30000 then v_slots := '{}'::jsonb; end if;

  -- 마지막 안전망: 두 넣기는 각자 하위 트랜잭션이라 크기 검사(check_violation)에 걸려도 그 보관만 건너뛰고 보내기는 계속된다.
  begin
    insert into public.research_archives (request_id, is_demo, request, purchase, verified, slots, messages, review)
      values (p_request_id, v_r.is_demo,
        jsonb_strip_nulls(jsonb_build_object('product', public.research_scrub_text(v_r.product),
          'budget', public.research_scrub_text(v_r.budget), 'condition', public.research_scrub_text(v_r.condition),
          'brand', public.research_scrub_text(v_r.brand), 'item', public.research_scrub_text(v_r.item),
          'conditionKind', v_r.condition_kind)),
        v_s.purchase, v_verified, v_slots,
        public.research_archive_messages(p_request_id),
        jsonb_build_object('final', v_final, 'draft', v_draft, 'rev', coalesce((v_s.review->>'rev')::int, 0)))
      on conflict (request_id) do nothing;
  exception when check_violation then
    raise warning 'research_archive_put: 대화 보관본을 건너뜀(%)', sqlerrm;
  end;

  -- research_send가 빈 리뷰를 먼저 거르므로 v_final은 비어 있지 않다(방어용 조건).
  if v_final <> '' then
    begin
      insert into public.research_reviews (request_id, is_demo, item, brand, product, model, purchase, verified,
        review_text, alts, benefit_links)
        values (p_request_id, v_r.is_demo, public.research_scrub_text(v_r.item), public.research_scrub_text(v_r.brand),
          public.research_scrub_text(v_r.product), nullif(v_model, ''), v_s.purchase,
          v_verified, v_final, v_alts, v_links)
        on conflict (request_id) do nothing;
    exception when check_violation then
      raise warning 'research_archive_put: 영구 리뷰를 건너뜀(%)', sqlerrm;
    end;
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
  -- 영구 리뷰에 넣을 문단이 없으면(세션 리뷰도 후보 1 가이드도 공백) 보내지 않는다.
  if public.research_final_review(v_s.review, p_candidates) = '' then
    return jsonb_build_object('outcome', 'review_not_confirmed');
  end if;
  -- 요청을 done으로 바꾸면 트리거가 세션을 지우므로, 그 전에 같은 트랜잭션에서 대화 글과 리뷰를 보관 표에 넣는다.
  perform public.research_archive_put(p_request_id, p_candidates);
  update public.requests as r set status = 'done', done_at = now(), updated_at = now()
    where r.id = p_request_id and r.status = 'in_progress' and r.volunteer_id = p_volunteer_id
    returning r.id into v_id;
  if v_id is null then
    -- 가드가 요청 행을 잠갔으므로 여기 올 수 없다. 오면 예외로 이 트랜잭션(보관 표 넣기 포함)을 통째로 되돌린다.
    raise exception 'research_send: request left in_progress while locked';
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
        and p.proname in ('research_url_decode', 'research_scrub_plain', 'research_scrub_text', 'research_final_review', 'research_strip_data', 'research_body_text',
          'research_archive_messages',
          'research_archive_put', 'research_send', 'research_sweep')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;
