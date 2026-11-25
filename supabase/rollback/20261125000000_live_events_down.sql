-- 20261125000000_live_events.sql 되돌리기. 사람이 실행한다(supabase/migrations 밖이라 자동으로 돌지 않는다).
-- 실행 뒤 `supabase migration repair --status reverted 20261125000000 --linked`도 실행해야 나중에 다시 적용할 수 있다.
-- 저장된 대화가 모두 사라진다. 지우기 전에 필요한 기록은 따로 내려받는다. 기존 표·함수는 바꾸지 않았으므로 건드리지 않는다.
drop table if exists public.live_events;
