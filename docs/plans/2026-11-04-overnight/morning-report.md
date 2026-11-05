# 11/4 밤샘 개발 아침 보고

작성: 2026-11-05 블록 7 세션(원래 07:00~08:00 시간표가 지나 같은 길이로 11/5 13:30~14:30에 진행). 기준 브랜치 `feat/integration` `a3ddff9`.

## 먼저 알아 둘 것

1. **8시 목표를 놓쳤다.** 블록 3이 01:55에 끝난 뒤 다음 블록이 자동으로 이어지지 않았다(원인은 확인하지 못했다). 11/5 약 10:00에 이용자가 재개해 블록 4(10:00~12:28, 끝 시각 11:30을 넘김), 블록 5(12:30~), 블록 6(12:50~13:50), 이 블록 7(13:30~)을 같은 길이로 다시 잡아 진행했다.
2. **공개 주소는 동작한다.** 오늘 최신 확인에서 `test:public` 3개 통과(첫 화면, 접근 코드와 health `groqKeyConfigured=true`, 완주). 가짜 음성 입력 기준이며 실제 아이폰·VoiceOver 판정이 아니다. `groqKeyConfigured: false`가 아니므로 이 항목은 해당 없다.
3. **PR #7, #9~#13은 전부 `hold-morning`이고 서로 위에 쌓여 있다.** 실패 이력이 있어 AI가 병합하지 않았다. 병합 순서와 방식은 아래 "병합 방식과 순서"에 있다. 이 보고 PR도 보고 문서만 담는다.
4. **실제 Groq 챗봇 20문항은 아직 돌지 않았다.** 이용자가 사람이 나중에 시험하기로 했다(PR #11이 `미완료`인 이유).

## 시연 주소와 배포

- 공개 주소: `https://lighthouse-web-five.vercel.app`. 접근 코드와 시연 주소는 저장소 루트 `.demo-access.local`(첫 줄 코드, 둘째 줄 시연 주소, git에는 없음)에 있다. 이 보고에는 값을 적지 않는다.
- 배포: 브랜치 `feat/integration`, 커밋 `4f6f31c`(배포 `lighthouse-5zrcoojc4`, Production, 13:09). 이후 브랜치 커밋 `a3ddff9`까지는 `progress.md`만 바뀌어 앱 코드가 같다(`git diff 4f6f31c a3ddff9`로 확인). 그래서 이 블록에서는 재배포하지 않았다.
- 공개 주소의 코드는 main과 다르다. main에는 #7 이후가 하나도 들어 있지 않다. 시연한 코드와 병합할 코드를 헷갈리지 않도록 이 커밋을 기억한다.
- 오늘 `test:public` 재통과: 13:26, 종료 코드 0, 3개 통과. 완주 답변 첫 줄 `검색어: Sony 헤드셋`, 소요 1,869ms, 답변 규칙 위반 0건, 단계 번호 `1. 2. 3.` 형식. 기록은 로컬 `test-results/13-test-public.txt`, `13-answer.txt`(git에는 없음. 접근 코드 값과 `gsk_` 형식 문자열 0건 확인).

## 시연 절차

눈을 가리고 아이폰에서 VoiceOver를 켠 채 진행한다(human.md:43).

1. VoiceOver를 켠다.
2. 눈을 가리기 전에 시연 주소를 한 번 열어 접근 코드 쿠키를 받는다.
3. 크롬에서 "sony껄로 헤드셋 사고싶어"라고 말한다.
4. 가상 봉사자와 매칭되면 "봉사자 화면으로(시연)" 버튼을 누른다.
5. 봉사자 화면에서 "sony 헤드셋 제품을 찾는 가이드 알려줘"라고 묻는다. 답에 검색어·확인할 조건·찾는 순서가 나오면 합격이다.

크롬 음성이 안 되면 입력창에 iOS 키보드 받아쓰기를 쓰거나 같은 주소를 사파리로 연다(봉사자 화면도 사파리에서 연다). 시도는 최대 3회다.

## PR 표

공통: 병합 기준은 `pr-flow.md` "병합" 표다. 실패 이력이 있거나 Codex·Bugbot을 한 번이라도 통과 못하면 `hold-morning`이다. Codex 판정은 전부 시험 기록 판정(Codex가 직접 실행하지 않음, Windows에서 `spawn EPERM`)이며 #8에서 규칙으로 바뀌는 중이다.

| # | 기능 | base ← head | 판정 | 실패 횟수와 목록 | AI 병합/보류와 이유 | 사람이 볼 것 |
|---|---|---|---|---|---|---|
| 7 | Next.js 뼈대, `/enter`, `/api/health` | `main` ← `feat/skeleton` `a47d40c` | `미완료`(Codex 최종 `실패`) | **4회**: Codex `실패` 3회(`spawn EPERM` 2, Production 접근 코드 미등록 1), `test:e2e` 1회(다른 세션의 포트 점유). Bugbot `success` 0건(10분 34초) | 보류. Codex 통과 못함, 실패 이력 | 본문 6항은 낡았다. 접근 코드와 Groq 키는 지금 등록돼 있고 공개 주소에서 확인했다(위 `test:public`). Vercel 설정(아래) |
| 8 | 규칙 변경: Codex를 시험 기록 판정으로 | `main` ← `docs/codex-log-judgement` `409b676` | 판정 기록 없음(규칙 문서 PR, Bugbot `neutral`) | 기록 없음 | 보류(`hold-morning` 라벨 없음, 규칙 변경이라 사람이 병합) | `pr-flow.md`만 바꾼다(10줄). 약점: 시험 실행이 독립 검증이 아니게 된다. 이 PR을 병합해야 이후 PR들의 판정 방식이 규칙과 맞는다 |
| 9 | 이용자 화면과 음성 입력 | `feat/skeleton` ← `feat/user-screen` `547c1e7` | `완료`(가짜 음성 입력 기준) | **1회**: `npm run check` eslint `no-this-alias`. Codex 통과, Bugbot 심각 0건·Low 1건(빈 값 두 번 제출 시 안내 같음, 10분 28초) | 보류. 쌓인 PR(#7 위), 실패 이력 | 실제 아이폰 음성, VoiceOver 낭독, `SPEECH_START_DELAY_MS=1000` 임시값 |
| 10 | 매칭과 시연 이어 보기 | `feat/user-screen` ← `feat/match` `e8a584f` | `완료`(가짜 음성 입력 기준) | **3회**: `test:e2e` 19건 401(WebKit `Secure` 쿠키), 같은 원인 확인 1회, `test:e2e` 3건(`document.title` 덮어쓰기는 실제 버그를 고침). Codex 통과, Bugbot `success` 0건 | 보류. 쌓인 PR, 실패 이력 | 봉사자 화면 안내와 h1 낭독이 겹치는지(`ANNOUNCE_DELAY_MS=100`ms 임시값), 매칭 직후 초점 낭독 |
| 11 | 봉사자 챗봇 | `feat/match` ← `feat/volunteer-chat` `8c2f7df` | **`미완료`**(실제 Groq 20문항 미실행) | **3회**: `test:e2e` 1건 30초 시간 초과(원인 미확인, 재현 안 됨), Bugbot 심각 1건(낭독 영역에 시연 안내가 돌아옴, 고침), Codex 심각 1건(20문항 없음). Codex 최종 `미통과` | 보류. Codex 미통과, 쌓인 PR | 20문항 실행(아래), 실제 답변 품질, VoiceOver 낭독(답변 도착 안내와 초점 겹침) |
| 12 | 통합 시험(공개 주소 완주)과 지시문 수정 | `feat/volunteer-chat` ← `feat/integration` `a3ddff9` | `완료`(`4f6f31c` 기준, 가짜 음성 입력 기준) | **2회**: `test:public` 답변 규칙 위반(항목 이름 앞 번호 3건), 같은 원인의 Codex 심각 1건. 이후 지시문을 고쳐 `4f6f31c`에서 3회 연속 통과. Bugbot Medium 1건(`public.spec.ts:88`)은 AI가 사소하다고 분류했고 고쳤다 | 보류. 쌓인 PR, 실패 이력, Codex 첫 판정이 통과 아님 | Medium 지적의 분류가 맞는지(사람이 뒤집으면 실패 1회 추가), 지시문 수정(`prompt.ts`) 검토, 형식 검증은 같은 질문 3회뿐 |
| 13 | 문서 초안(컴포넌트, 화면, 사용자 플로우) | `feat/integration` ← `docs/overnight-drafts` `d4286e1` | 문서라 Codex 해당 없음, Bugbot `pass` | 0회 | 보류. 문서는 사람 검토 대상 | 초안은 `870c13c` 기준이라 `prompt.ts` 줄 번호 등이 지금과 다를 수 있다. 하위 에이전트 초안을 표본 대조만 했다(전수 아님). 팀 일정표 형식은 미확인 |
| 이 PR | 아침 보고 | `feat/integration` ← `docs/morning-report` | 문서라 Codex 해당 없음. Bugbot은 PR 본문에 기록 | 이 블록 0회(훅 차단 1회는 세지 않음, 아래) | 보류. 보고 문서 | 이 보고 |

### 실패 횟수의 근거

- **이 세션이 직접 확인한 것**: GitHub에서 PR 상태·base·head·병합 가능 여부·체크 결과를 조회했다. 각 PR 본문의 실패 횟수와 `progress.md` 숫자를 맞춰 봤다. #9·#10·#11은 시험을 돌린 커밋 이후 PR head까지 `progress.md`만 바뀌었고, #12는 `92d6341`과 `4f6f31c` 사이에 `prompt.ts`와 시험 2개가 바뀐 것이 맞다(`git diff`).
- **세션 자기 신고(이 세션이 재현하지 않음)**: 실패가 실제로 그 횟수였는지, 각 `npm run check`·`test:e2e` 결과, Codex·Bugbot 판정의 내용(PR 댓글 원문은 읽지 않았다). `check`와 `test:e2e`는 이 블록에서 다시 돌리지 않았다.
- **불일치 1건**: #7은 PR 본문이 4회이고 `feat/skeleton`의 `progress.md`도 4회로 갱신돼 있다. 그러나 `feat/integration`에 있는 `progress.md`의 블록 1 머리글과 실패 목록은 옛 값(2회)이다(#9가 갱신 전에 분기). 병합하면 4회로 갱신된 줄이 들어온다(아래 시뮬레이션에서 확인). 이 표는 4회로 적었다.
- Groq 호출 횟수는 `progress.md` 기준이다(이 세션은 Groq 쪽 사용량을 조회하지 않았다).

## 병합 방식과 순서

**쌓인 구조**(GitHub에서 확인): `main` ← #7(`feat/skeleton`) ← #9(`feat/user-screen`) ← #10(`feat/match`) ← #11(`feat/volunteer-chat`) ← #12(`feat/integration`) ← #13(`docs/overnight-drafts`)와 이 보고 PR. 뒤 PR의 base는 앞 PR의 브랜치이지 main이 아니다. #8은 `.claude/rules/pr-flow.md`만 바꾸고 이 사슬과 겹치는 파일이 없다.

**권고: 병합 커밋(merge commit)으로 아래에서 위로 병합한다.**

- 확인한 것(로컬 시뮬레이션, 저장소 본체는 건드리지 않음): #7을 squash로 병합한 상태에서 #9의 head(`feat/user-screen`)를 main에 합치면 **4개 파일이 충돌**한다(`CLAUDE.md`, `apps/web/src/app/globals.css`, `apps/web/src/app/page.tsx`, `docs/plans/2026-11-04-overnight/progress.md`). 다음 단계(#10)도 같은 식으로 충돌이 난다(`CLAUDE.md` 등). 같은 파일을 앞 PR이 만들고 뒤 PR이 고쳤는데 squash는 앞 PR의 커밋 이력을 main에 남기지 않기 때문이다.
- 확인한 것: 같은 시뮬레이션에서 main에 #7, #9, #10, #11, #12, #13을 `git merge --no-ff`(병합 커밋)로 순서대로 합치고 #8까지 더했을 때 **충돌이 0건**이었다. GitHub의 실제 병합과 세부가 다를 수 있다.
- `pr-flow.md`는 AI 병합에 squash를 쓰라고 한다. 사람 병합에서는 이용자가 다르게 택해도 된다. 이 PR들은 AI 병합 조건을 채우지 못해 사람이 병합하므로 위 권고가 맞다고 본다. squash를 꼭 쓰려면 충돌을 직접 풀어야 한다.

**순서와 base 바꾸기**

1. #8(독립). 규칙 변경이라 먼저 읽고 정한다.
2. #7을 main에 병합.
3. #9의 base를 `main`으로 바꾼 뒤 병합(`gh pr edit 9 --base main`). 같은 식으로 #10, #11, #12를 차례로. 앞 PR의 브랜치가 남아 있으면 GitHub은 자동으로 base를 바꾸지 않는다. 브랜치를 지우면 자동으로 바꿔 주는 것은 GitHub의 일반 동작으로 알고 있으나 **이 저장소에서 시험하지 않았고**, 이 저장소는 `병합 시 브랜치 삭제`가 꺼져 있다.
4. #13과 이 보고 PR은 base가 `feat/integration`이다. #12를 병합한 **뒤** base를 `main`으로 바꿔 병합한다. 바꾸지 않고 병합하면 내용이 `feat/integration` 브랜치에만 들어가고 main에는 들어가지 않는다.

대안(시뮬레이션하지 않았고 추측이다): 위에서 아래로, 즉 #13과 이 PR을 `feat/integration`에, #12를 `feat/volunteer-chat`에, … #9를 `feat/skeleton`에 병합하고 마지막에 #7을 main에 병합하면 base를 바꿀 필요가 없다. 대신 각 PR을 따로 보류할 수 없다.

## 병합 전·후 이용자 확인 목록

**병합 전**

- Vercel 프로젝트 `lighthouse-web`(팀 `iborys-projects`) 설정이 문서와 다르다. 현재 설정: Root Directory `.`, Node.js `26.x`(이 세션은 읽지 않았고 블록 5 기록 `progress.md`를 인용한다). 반면 `CLAUDE.md`와 `docs/TSD.md:64-65,289`는 Root Directory `apps/web`, Node 22이고 `apps/web/package.json`의 `engines.node`도 `22.x`다. 지금은 `apps/web`에서 `vercel deploy --prod --yes`로 배포해 빌드가 된다. 어느 쪽을 맞출지 이용자가 정한다. 이 세션은 설정을 바꾸지 않았다.
- Production에 이름이 틀린 옛 `Groq_API_key`가 남아 있다(블록 5 기록). 코드는 `GROQ_API_KEY`만 읽으며, 공개 주소 health가 `groqKeyConfigured=true`이므로 올바른 이름의 키도 지금 있다. 옛 항목은 정리하면 된다. 이 세션은 지우지 않았다.

**병합 후**

- main 병합이 Production 자동 배포를 만드는지 **모른다.** 확인한 것: Vercel Git 연동이 있어 #11~#13의 체크에 `Vercel` 항목이 있고 `vercel ls`에 Preview 배포가 쌓여 있다(Preview 배포가 앱을 정상 구동하는지는 확인하지 못했다). Production 배포 3건(`c54fil5xz`, `3hbh1t5lc`, `5zrcoojc4`)은 블록 5·6의 CLI 수동 배포로 추정된다. Production 브랜치 설정과 자동 배포 여부는 이 세션이 확인하지 못했다. 병합 직후 Vercel 대시보드의 배포 목록을 한 번 본다.
- 병합 뒤에도 공개 주소(`4f6f31c`)와 main이 같은지 확인한다. 같지 않으면 `apps/web`에서 `vercel deploy --prod --yes`로 다시 배포하고 `test:public`(Groq 1회)을 돌린다.

## 사람 판정 항목

AI는 아래를 판정하지 못한다. 모든 화면 시험은 `가짜 음성 입력 기준`이다.

1. **실제 아이폰 음성 인식과 VoiceOver 낭독**: 이용자 화면, 봉사자 화면의 안내와 h1 낭독이 겹치는지, "듣고 있습니다. 말씀하세요."가 인식 문장에 섞이는지, "답변이 도착했습니다."와 답변 영역 초점이 겹치는지.
2. **`SPEECH_START_DELAY_MS=1000`**: 임시값이다. 이용자가 0블록에서 시험한 버튼이 즉시 시작인지 1초 뒤인지 모른다. 이용자가 답하면 바꾼다.
3. **실제 Groq 챗봇 20문항(PR #11 `미완료` 사유)**: `apps/web`에서 키가 보이는 환경으로 아래만 돌린다. 20문항을 7초 간격으로 호출하고 답변 원문을 저장소 루트 `test-results/chatbot-<시각>.json`에 남긴다(`progress.md` 블록 4). 실제 Groq 호출 20회가 늘어난다(누계 6회에서 26회, 상한 200).

```bash
cd apps/web && npm run test:chatbot
```

4. **Bugbot Medium 지적(PR #12 `public.spec.ts:88`)**: AI가 사소하다고 분류하고 고쳤다. 사람이 뒤집으면 실패 1회가 추가된다.
5. **문서 초안(PR #13)**: 하위 에이전트가 쓰고 표본 대조만 했다. 전수 확인이 아니고, 기준 코드가 `870c13c`다.

## 코드에서 드러났으나 고치지 않은 것

모두 이 블록 범위 밖이라 고치지 않았다. 코드를 직접 확인했다.

- **품목이 "헤드셋"뿐이라 봉사자가 항상 A다**: `apps/web/src/lib/volunteers.ts:10-11`에서 A는 `헤드셋`, B는 `헤드셋`·`키보드`이고 순서상 A가 먼저 걸린다.
- **`/volunteer`에 접근 검사가 없다**: 쿠키 없이 페이지가 열린다. 서버 함수(`/api/chat`, `/api/match`)만 쿠키를 확인해 401을 낸다(`access.ts`의 `hasAccess`를 쓰는 곳은 API route 3개).
- **`/api/chat`이 `requestId`를 쓰지 않고 `context`를 대조하지 않는다**: `requestId`는 형식만 검사하고(`lib/chat.ts:26`) 서버에 저장된 매칭과 비교하지 않는다. `context`의 `brand`·`item`은 클라이언트가 보낸 값을 그대로 지시문에 쓴다(`api/chat/route.ts:59`, `lib/llm.ts:67`). 서버에 매칭 저장소가 없어 대조할 대상이 없다.
- **횟수 제한이 `x-forwarded-for`의 첫 값을 믿는다**(`lib/rateLimit.ts:51-53`). 코드 주석은 Vercel이 실제 접속 주소로 덮어쓴다고 적었다. 이 세션이 확인하지 않았다. 서버 메모리에 세므로 재시작하면 초기화되는 완화 수단이다.
- **답변 형식 검증은 같은 질문 3회뿐이다**: `4f6f31c` 지시문 수정 뒤 3회가 같은 질문("sony껄로 헤드셋")이다. 다른 질문에서 형식이 지켜지는지 모른다. 실행 중에 답변을 거르는 코드는 없다.

## 미완료와 막힌 이유

- PR #11 `미완료`: 실제 Groq 20문항 미실행. 이용자가 사람이 나중에 시험하기로 했다. 막힌 이유는 블록 4 실행 환경에 `GROQ_API_KEY`가 보이지 않았고, 이후 Development 키 사용에 이용자 답이 없었기 때문이다.
- PR #7 `미완료`: Codex 판정이 `실패`로 끝났다(원인: Windows 샌드박스 `spawn EPERM`, 이후 Production 접근 코드 미등록). 접근 코드와 키는 지금 등록돼 공개 주소에서 통과하지만 Codex를 새 기록으로 다시 판정하지 않았다.
- 훅·권한 차단(실패로 세지 않음, 우회하지 않음): 이 블록에서 임시 복제본에 병합 시뮬레이션을 하는 명령에 `git commit`이 들어 있어 훅이 `커밋 대상 폴더를 확인하지 못함`으로 차단했다. 같은 시뮬레이션을 `git merge-tree`와 `git merge`로 다시 했다. 훅은 고치지 않았다. 블록 1·6에도 같은 종류의 차단이 있었다.
- 이 블록은 문서 PR이라 Codex를 돌리지 않았다. Bugbot은 PR 본문에 결과를 적는다.

## 실제 사용량과 예상 차이

- 토큰: 미측정(호출 누적 입력/출력을 잴 수 없다). 예상(6,500만/55만) 대비 미측정. 이 세션 문맥은 약 19만 토큰.
- 주간 사용량(Ultra, 전체 모델): 계획 작성 때 26%(human.md:48), 블록 1 끝 26%, 블록 3 끝 27%, 지금 28%. 낮 사용이 섞여 밤샘 몫만 떼어 낼 수 없다. 계획의 한도(밤샘 12% 이내)를 넘지 않았다.
- 실제 Groq 호출 누계 6회(블록 5 1회, 블록 6 4회, 블록 7 1회, 이 기록 기준). 상한 200회. 시험에서 가로챈 호출은 세지 않았다.
- 돈: Groq·Vercel 0원. Bugbot 사용량과 Cursor 대시보드의 포함량은 이 세션이 확인하지 못했다.

## 이용자가 가장 먼저 할 일

1. 시연 절차로 눈 가리고 한 번 시험한다(위 절차). 크롬 음성 실패 시 입력창이나 사파리.
2. PR #8을 먼저 판단하고, #7부터 병합 커밋으로 병합한다(순서·base 바꾸기는 위 "병합 방식과 순서").
3. Vercel 프로젝트 설정(Root Directory, Node 버전)을 문서와 맞출지 정하고, 옛 `Groq_API_key`를 정리한다.
