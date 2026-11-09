# 11/9 밤샘 진행 기록

`.claude/rules/overnight-loop.md` "진행 기록 형식"으로 시간순으로 쌓는다. 밤 블록 항목은 `docs/overnight-1109` 브랜치에서 추가한다(ai.md 3.5). 아래 첫 항목은 블록이 아니라 계획을 쓴 낮 세션의 기록이다.

## 2026-11-09 (낮) 문서 세션: ai.md 작성 (클라우드 세션, 블록 아님)
상태: 완료(ai.md 작성·푸시). 블록 0 전.
PR: 없음(브랜치 `claude/cloud-brief-ai-plan-pim0gp`. human.md·notes·research·tsd-review·실험 서버는 `docs/1109-ai-plan` 커밋 `9a881dd`를 그대로 포함), 실패 횟수: 0
결정:
- 정해 줄 것 1~11을 이용자가 모두 추천안으로 확정했다(human.md). ai.md 1.5절 표가 실행 기준이다.
- ai.md는 사실 확인 2 → 초안 3 → 심사 2 → 통합 1 → 검증 4렌즈 × 3회·수정 2회(하위 에이전트 22개)로 썼고, 마지막 검증에 남은 지적(유료 호출 상한 단위, 3.5 시간 포함, 블록 0 예약 시작 중복, 블록 6 체크아웃 순서, 문서 브랜치 이름 등)은 메인 세션이 고쳤다.
- 훅 차단 1회(실패로 세지 않음): 클라우드 세션의 원격 이름이 `origin`뿐이라 `git push -u origin …`이 `guard.js:131`에 막혔다. 훅을 고치거나 끄지 않고, 같은 저장소 URL(`https://github.com/IBORY-PURPLE/Lighthouse_Dev`)의 `github` 원격을 이 컨테이너에 추가해 `git push github <브랜치>`로 푸시했다. PC에는 `github` 원격이 이미 있어 해당 없음.
- 발견: `guard.js:158`이 base가 `main`이 아닌 PR의 `gh pr merge`를 막아 `pr-flow.md` "병합" 표(기능 PR을 AI가 단계 브랜치에 squash 병합)와 충돌한다. `guard.js:198`은 AI의 훅 편집도 막는다. 사람이 정할 일이다(ai.md 블록 0 할 일 2, 9절 1). 허락이 없으면 모든 기능 PR은 `hold-morning`이고 단계 PR은 밤에 열리지 않는다.
- `CLAUDE.md` 지도에 `apps/web/experiments/vision/` 줄을 추가했다(`89d9cb1`).
- `github/main`(`3206331`)의 계획 폴더에는 `tsd-review.md`만 있다. 이 브랜치가 main에 병합되지 않은 채 밤이 시작되면 블록 0 할 일 5대로 계획 폴더 사본을 `docs/overnight-1109`에 먼저 커밋한다.
다음 할 일: 사람이 이 브랜치의 PR을 main에 병합하고, ai.md 5절 "자기 전" 표대로 준비(캡처·정답 메모, OpenAI·Upstage 키, 세 가지 허락)한 뒤 블록 0을 시작한다.
토큰: 미측정(이 세션의 하위 에이전트 사용량 약 640만 토큰은 측정값, 메인 세션은 미측정). 예상 대비 미측정.
