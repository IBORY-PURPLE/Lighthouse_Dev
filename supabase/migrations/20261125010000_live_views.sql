-- /live 대화 기록(live_events)을 사람별·통화별로 읽는 보기(view) 3개. 마이그레이션 11. 2026-11-25 이용자 요청.
-- 추가형: 표와 함수를 바꾸지 않는다. 줄을 새로 저장하지 않고 live_events를 읽어 그때그때 계산한다(이미 쌓인 줄에도 바로 적용된다).
-- 저장 경로(POST /api/live/log → live_events insert)에는 손대지 않는다. 트리거도 두지 않는다.
--   live_people     한 줄 = 사람(기기) 하나
--   live_calls      한 줄 = 통화 하나(cid)
--   live_transcript 한 줄 = 말 한 마디(글이 든 줄만, 사건 줄은 뺀다)
-- 세 보기는 device_id(사람)와 cid(통화)로 이어진다.
-- person_no: 기기 번호(device_id)마다 1, 2, 3…(처음 말한 순서). QA 참가자가 각자 자기 폰을 쓰므로 사람과 같다(2026-11-25 이용자 말).
-- name_said: AI가 성함을 처음 여쭌 줄 바로 다음에 그 기기의 이용자가 한 말(원문 그대로). 음성 인식 글이라 틀릴 수 있고
--   "○○○입니다"처럼 문장째로 들어온다. 여쭙기 전에 끝난 기기는 ''이다. 조사를 떼다 이름이 잘릴 수 있어 다듬지 않는다.
-- call_no: 그 기기 안에서 통화 1, 2, 3…(시작한 순서).
-- 이용자 말이 한 줄도 없는 통화(화면만 열었다 닫은 것)는 세 보기에서 뺀다. live_events에는 그대로 있다.
-- security_invoker: 보는 쪽의 권한으로 live_events를 읽는다(보기가 행 보안을 건너뛰어 바깥 키로 읽히지 않게).
-- 대시보드(postgres)에서만 본다. Supabase 기본 권한이 새 보기에도 모든 권한을 주므로 anon, authenticated, service_role에서 걷어 낸다.
-- 되돌리기: supabase/rollback/20261125010000_live_views_down.sql (사람이 실행).

create view public.live_calls with (security_invoker = true) as
with calls as (
  select device_id,
         cid,
         min(created_at)                       as started_at,
         min(created_at) filter (where kind = 'user') as first_said_at,
         max(at_ms)                            as last_ms,
         count(*) filter (where kind = 'user') as user_lines,
         count(*) filter (where kind = 'ai')   as ai_lines,
         count(*)                              as total_lines,
         bool_or(tag = 'REGISTER_OK')          as registered,
         coalesce(string_agg(distinct engine, ',') filter (where engine <> ''), '') as engine,
         max(label)                            as label,
         max(env)                              as env
    from public.live_events
   group by device_id, cid
  having count(*) filter (where kind = 'user') > 0
), people as (
  select device_id,
         -- 화면을 먼저 연 순서가 아니라 처음 말한 순서다(먼저 열어 두고 나중에 말한 기기가 앞 번호를 차지하지 않게).
         dense_rank() over (order by min(first_said_at), device_id) as person_no
    from calls
   group by device_id
), asked as (
  select distinct on (device_id) device_id, cid, seq
    from public.live_events
   where kind = 'ai' and body like '%성함%'
   order by device_id, created_at, seq
), names as (
  select distinct on (a.device_id) a.device_id, e.body as name_said
    from asked a
    join public.live_events e
      on e.device_id = a.device_id and e.cid = a.cid and e.seq > a.seq and e.kind = 'user'
   order by a.device_id, e.seq
)
select coalesce(n.name_said, '')                                                 as name_said,
       p.person_no,
       row_number() over (partition by c.device_id order by c.started_at, c.cid) as call_no,
       to_char(c.started_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS')       as started_kst,
       (c.last_ms / 1000)                                                        as seconds,
       c.user_lines,
       c.ai_lines,
       c.total_lines,
       c.registered,
       c.engine,
       c.label,
       c.env,
       c.device_id,
       c.cid
  from calls c
  join people p using (device_id)
  left join names n using (device_id)
 order by p.person_no, call_no;

create view public.live_people with (security_invoker = true) as
select name_said,
       person_no,
       count(*)                       as calls,
       sum(user_lines)                as user_lines,
       sum(total_lines)               as total_lines,
       count(*) filter (where registered) as registered_calls,
       min(started_kst)               as first_kst,
       max(started_kst)               as last_kst,
       device_id
  from public.live_calls
 group by name_said, person_no, device_id
 order by person_no;

create view public.live_transcript with (security_invoker = true) as
select c.name_said,
       c.person_no,
       c.call_no,
       e.seq,
       round(e.at_ms / 1000.0, 1) as at_sec,
       case e.kind when 'user' then '이용자' when 'ai' then 'AI' else '앱 안내' end as speaker,
       e.body                     as said,
       e.tag,
       e.engine,
       e.device_id,
       e.cid
  from public.live_events e
  join public.live_calls c using (device_id, cid)
 where e.kind <> 'event'
 order by c.person_no, c.call_no, e.seq;

revoke all on public.live_calls from anon, authenticated, service_role;
revoke all on public.live_people from anon, authenticated, service_role;
revoke all on public.live_transcript from anon, authenticated, service_role;
