-- 20261122000000_request_details.sql 되돌리기. 사람이 실행한다(supabase/migrations 밖이라 자동으로 돌지 않는다).
-- 실행 뒤 `supabase migration repair --status reverted 20261122000000 --linked`도 실행해야 나중에 다시 적용할 수 있다.
-- 저장된 질문·답이 모두 사라진다. 기존 표·함수는 바꾸지 않았으므로 건드리지 않는다.
drop trigger if exists request_details_drop_on_close on public.requests;
drop function if exists public.request_details_drop_on_close();
drop table if exists public.request_details;
