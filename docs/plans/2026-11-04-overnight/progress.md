# 11/4 밤샘 진행 기록

항목 형식은 `.claude/rules/overnight-loop.md`를 따른다. 다음 세션은 마지막 항목만 읽는다.

## 00:20 블록 0 사전 점검
상태: 완료
PR: 없음(speech-probe는 [#5](https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/5)로 main에 있음. Codex를 돌리지 않았고 Bugbot은 문서 PR이라 `skipping`), 실패 횟수: 0
결정:
- 통과: gh 로그인, vercel 로그인, codex 로그인, `github` 원격, `ANTHROPIC_API_KEY` 없음, `hold-morning` 라벨, `evidence` 브랜치.
- Vercel 프로젝트: `lighthouse-web`(`apps/web/.vercel`에 링크). 이 프로젝트에만 배포한다.
- Bugbot 수신은 [#2](https://github.com/IBORY-PURPLE/Lighthouse_Dev/pull/2)의 `SUCCESS`로 확인.
- 고정 주소 `lighthouse-web.vercel.app/speech-probe/`는 블록 0 시점에 308 후 404였다. 해시 주소에서는 200. 블록 1에서 확인한다.
- `GROQ_API_KEY`는 Vercel에 Development로만 등록돼 있었다. 이용자에게 Production 등록을 요청했다. 블록 4 전에 다시 확인한다.
- 아이폰 음성 시험 결과를 아직 받지 못했다. 답이 오기 전 기본값은 `PRIMARY_INPUT='text'`, `SPEECH_START_DELAY_MS=0`.
- 시작이 늦어 블록 1 구현 01:15, 검증 포함 01:30 끝으로 조정했다. 30분 지연은 블록 6 버퍼에서 흡수한다.
다음 할 일: 블록 1 `feat/skeleton`
토큰: 미측정
