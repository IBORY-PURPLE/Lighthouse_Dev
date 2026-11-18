-- 이용자 음성 요청의 확인 요약과 질문·답(봉사자 브리핑). 마이그레이션 4.
-- 추가형: 기존 표·함수를 바꾸지 않는다.
-- 서버가 맡은 봉사자에게만 내보낸다. 요청이 done·expired가 되면 트리거가 지우고, 요청이 지워지면 cascade로 같이 지워진다.
-- 내려놓기(in_progress → waiting)와 6시간 반환 때는 지우지 않는다(다음 봉사자가 봐야 한다).
-- 되돌리기: supabase/rollback/20261122000000_request_details_down.sql (사람이 실행).
create table public.request_details (
  request_id uuid primary key references public.requests (id) on delete cascade,
  summary text not null default '' check (char_length(summary) <= 300),
  qa jsonb not null default '[]'::jsonb
    check (jsonb_typeof(qa) = 'array' and jsonb_array_length(qa) <= 12 and octet_length(qa::text) <= 16000),
  created_at timestamptz not null default now()
);

alter table public.request_details enable row level security;
revoke all on table public.request_details from anon, authenticated;
grant select, insert, delete on table public.request_details to service_role;

create or replace function public.request_details_drop_on_close()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.request_details as d where d.request_id = new.id;
  return null;
end;
$$;

create trigger request_details_drop_on_close
  after update of status on public.requests
  for each row
  when (new.status in ('done', 'expired') and new.status is distinct from old.status)
  execute function public.request_details_drop_on_close();
