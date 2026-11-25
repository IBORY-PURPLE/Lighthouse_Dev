-- 이용자 리뷰 도착 웹 푸시 구독(A13, 2026-11-17 이용자 결정). 마이그레이션 3.
-- 요청 하나에 구독 하나(마지막으로 받은 것). 요청이 지워지면 같이 지워진다.
-- 봉사자가 리뷰를 보내면 서버가 이 구독으로 알림을 한 번 보내고 지운다. 값은 알림 전송에만 쓴다.
-- 추가형이다. 기존 표·함수를 바꾸지 않는다.
-- 되돌리기: supabase/rollback/20261120000000_push_subscriptions_down.sql (사람이 실행).

create table public.push_subscriptions (
  request_id uuid primary key references public.requests (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 12 and 1000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;
