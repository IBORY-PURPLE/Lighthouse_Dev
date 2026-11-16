-- 20261117000000_research_conversation.sql 되돌리기. 사람이 실행한다(supabase/migrations 밖이라 자동으로 돌지 않는다).
-- 실행 뒤 `supabase migration repair --status reverted 20261117000000 --linked`도 실행해야 나중에 다시 적용할 수 있다.
-- 기존 표·함수 5개는 건드리지 않는다. research_* 표의 데이터(대화, 사용량)는 사라진다.
-- 20261117010000(보관)이 적용돼 있으면 20261117010000_research_archive_down.sql을 먼저 돌린다. 안 그러면 아래 반복문이
-- 보관용 research_% 함수까지 지워 research_archives·research_reviews 표만 고아로 남는다.
-- begin~commit 한 트랜잭션이라 psql -f로 돌려도 중간에 실패하면 전부 취소된다(잠금은 3초 안에 못 잡으면 실패).

begin;
set local lock_timeout = '3s';

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

commit;
