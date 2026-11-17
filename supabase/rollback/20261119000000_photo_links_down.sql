-- 20261119000000_photo_links.sql 되돌리기. 사람이 실행한다(supabase/migrations 밖이라 자동으로 돌지 않는다).
-- 실행 뒤 `supabase migration repair --status reverted 20261119000000 --linked`도 실행해야 나중에 다시 적용할 수 있다.
-- photo_links 표(링크·grant 기록)와 photo_link_* 함수를 지우고 research_add_photo를 인자 10개 옛 정의로 되돌린다.
-- 이전 마이그레이션 파일은 고치지 않았다. 아래 research_add_photo는 20261117000000의 정의와 같다.

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'photo\_link\_%'
  loop
    execute format('drop function if exists %s', v_fn);
  end loop;
end;
$$;

drop table if exists public.photo_links;

drop function if exists public.research_add_photo(uuid, text, uuid, text, text, text, text, jsonb, jsonb, jsonb, text);

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

revoke execute on function public.research_add_photo(uuid, text, uuid, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.research_add_photo(uuid, text, uuid, text, text, text, text, jsonb, jsonb, jsonb) to service_role;
