-- 리뷰 초안(draft)도 읽은 시점의 version과 대조한다(PR #46 Codex 지적).
-- 리뷰 POST는 AI를 기다리는 동안 칸이 바뀔 수 있다. 옛 칸으로 만든 초안이 저장되면 이후 검수·보내기가 통과한다.
-- 20261117000000의 research_set_review는 draft일 때 p_base_version을 보지 않았다.
-- 바뀐 것: p_base_version이 null이 아니면 draft·confirmed 모두 version과 달라야 stale. confirmed는 null이어도 stale(그대로).
-- 함수 이름·인자·반환값·권한은 그대로이고, 이전 마이그레이션 파일은 고치지 않았다. 되돌리려면 20261117000000의 함수 정의를 다시 실행한다.
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
  if (v_status = 'confirmed' and p_base_version is null)
     or (p_base_version is not null and p_base_version <> v_s.version) then
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

revoke execute on function public.research_set_review(uuid, text, uuid, int, jsonb) from public, anon, authenticated;
grant execute on function public.research_set_review(uuid, text, uuid, int, jsonb) to service_role;
