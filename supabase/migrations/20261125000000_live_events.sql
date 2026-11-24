-- /live(음성 대화 화면) 대화 기록. 마이그레이션 10. QA 기간(2026-12-03까지) 이용자가 나눈 말을 기기 번호별로 쌓는다.
-- 추가형: 기존 표·함수를 바꾸지 않는다.
-- requests와 묶지 않는다(외래 키 없음). 요청은 48시간·7일 뒤 지워지지만 이 기록은 QA 뒤에 읽어야 하므로 남아야 한다.
-- 기본 키는 (cid, seq)다. cid는 화면이 대화마다 만든 임의 UUID, seq는 그 대화 안의 줄 번호(0~999)다.
--   약점: 다른 기기가 같은 cid·seq를 먼저 쓰면 뒤 줄이 조용히 버려진다(on conflict do nothing). cid가 임의 UUID라 가능성이 낮다.
-- 서버는 덧붙이기(insert)와 읽기(select)만 한다. 수정·삭제 권한은 service_role에게도 주지 않는다.
-- 보관 30일(2026-11-24 이용자 결정). pg_cron이 없으므로 지우는 일은 사람이 한다:
--   delete from public.live_events where delete_after <= current_date;
-- 되돌리기: supabase/rollback/20261125000000_live_events_down.sql (사람이 실행).
create table public.live_events (
  cid          uuid        not null,
  seq          integer     not null check (seq between 0 and 999),
  device_id    text        not null check (device_id ~ '^u-[0-9a-f]{32}$'),
  kind         text        not null check (kind in ('user', 'ai', 'app', 'event')),
  tag          text        not null default '' check (tag ~ '^[A-Za-z0-9_:.-]{0,40}$'),
  body         text        not null default '' check (char_length(body) <= 1000),
  phase        text        not null default '' check (phase ~ '^[a-z]{0,16}$'),
  engine       text        not null default '' check (engine in ('', 'realtime', 'fallback')),
  at_ms        integer     not null default 0 check (at_ms between 0 and 86400000),
  label        text        not null default '' check (label ~ '^[A-Za-z0-9_-]{0,12}$'),
  env          text        not null default '' check (env ~ '^[a-z]{0,12}$'),
  created_at   timestamptz not null default now(),
  delete_after date        not null default ((now() at time zone 'Asia/Seoul')::date + 30),
  primary key (cid, seq),
  check (kind <> 'event' or (body = '' and tag <> ''))
);

create index live_events_device_idx on public.live_events (device_id, created_at);

alter table public.live_events enable row level security;
-- Supabase 기본 권한이 service_role에게 모든 권한을 주므로, grant만으로는 update·delete가 막히지 않는다. 먼저 걷어 낸다.
revoke all on table public.live_events from anon, authenticated, service_role;
grant select, insert on table public.live_events to service_role;
