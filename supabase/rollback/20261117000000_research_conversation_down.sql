-- 20261117000000_research_conversation.sql 되돌리기. 사람이 실행한다(supabase/migrations 밖이라 자동으로 돌지 않는다).
-- 실행 뒤 `supabase migration repair --status reverted 20261117000000 --linked`도 실행해야 나중에 다시 적용할 수 있다.
-- 기존 표·함수 5개는 건드리지 않는다. research_* 표의 데이터(대화, 사용량)는 사라진다.

drop trigger if exists research_drop_on_leave on public.requests;

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'research\_%'
  loop
    execute format('drop function if exists %s', v_fn);
  end loop;
end;
$$;

drop table if exists public.research_photos;
drop table if exists public.research_turns;
drop table if exists public.research_messages;
drop table if exists public.research_sessions;
drop table if exists public.research_usage;
drop table if exists public.ai_usage_daily;
