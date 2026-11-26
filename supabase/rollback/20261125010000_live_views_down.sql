-- 20261125010000_live_views.sql 되돌리기. 보기 3개만 지운다. live_events의 줄은 그대로다.
drop view if exists public.live_transcript;
drop view if exists public.live_people;
drop view if exists public.live_calls;
