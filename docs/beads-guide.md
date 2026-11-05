# beads(`bd`) 1쪽 사용 가이드

beads는 AI와 사람이 함께 쓰는 할 일 장부다. 할 일 사이의 순서를 기억하고, 지금 시작할 수 있는 일만 골라 준다. 세션이 바뀌어도 내용이 남는다.

## 이 프로젝트의 세팅

- 버전 1.3.4. 설치 위치는 `C:\Users\chewo\.local\bin\bd.exe`.
- **이 PC 전용이다.** 데이터는 저장소의 `.beads/`에 있고 git에 올라가지 않는다. 어느 브랜치, 어느 worktree에서든 같은 장부를 본다.
- 서버 동기화는 꺼져 있다. 다른 PC와 클라우드 세션에서는 이 장부가 보이지 않는다.
- 이슈 번호는 `lh-3sy`처럼 붙는다. bd 사용 통계는 껐다.
- **Claude 연동:** 세션을 시작할 때마다 `bd prime`(작업 안내, 약 6KB)이 자동으로 들어온다. `.claude/settings.json`의 SessionStart 훅이 실행하는 것이고, `CLAUDE.md`의 안내 블록은 그 사실을 알리는 문서다. 이 두 파일은 git에 올라가므로 bd가 없는 환경에서는 훅이 오류를 낼 수 있다.
- **git 훅:** 이 PC의 `.git/hooks/`에 5개를 설치했다. 지금 설정(`export.auto` 꺼짐)에서는 아무 일도 하지 않는다. git에 올라가지 않아 이 PC에서만 있다.

## 자주 쓰는 명령

| 하고 싶은 일 | 명령 |
|---|---|
| 지금 시작할 수 있는 일 보기 | `bd ready` |
| 할 일 만들기 | `bd create "제목" -p 1 -d "설명"` |
| 버그로 만들기 | `bd create "제목" -t bug -p 0` |
| 순서 걸기(A가 끝나야 B 시작) | `bd dep add <B> <A>` |
| 내가 맡기(진행 중으로 바뀜) | `bd update <id> --claim` |
| 내용 보기 | `bd show <id>` |
| 끝내기 | `bd close <id> --reason "한 일"` |
| 열린 일 전부 / 닫힌 일까지 | `bd list` / `bd list --all` |
| 큰 일 아래에 작은 일 달기 | `bd create "큰 일" -t epic` 뒤 `bd create "작은 일" --parent <id>` |

우선순위는 0이 가장 높고 4가 가장 낮다. 지정하지 않으면 2다.

## 예시: 순서가 있는 일

```bash
bd create "음성 입력 오류 문구 정리" -p 1     # lh-aaa 생성
bd create "오류 문구 VoiceOver 확인" -p 1     # lh-bbb 생성
bd dep add lh-bbb lh-aaa                      # aaa가 끝나야 bbb 시작
bd ready                                      # aaa만 나온다
bd close lh-aaa --reason "문구 수정"           # 이제 bbb가 나온다
```

## AI에게 시킬 때

말로 시키면 된다. 예: "`bd ready` 보고 다음 일 해 줘", "이 작업을 beads 이슈로 쪼개 줘", "남은 일을 이슈로 남겨 줘". 규칙은 `.claude/rules/beads.md`에 있다.

## 이 프로젝트에서 하지 말 것

- `bd dolt push`: 전체 기록이 원격에 올라간다. `bd dolt remote add`는 올릴 원격을 등록한다. bd는 git `origin`을 기본 후보로 잡는다.
- `bd init --reinit-local`(`--force`): 기존 장부를 덮어쓴다. 옵션 없는 `bd init`은 이미 초기화되어 있어 오류로 끝난다.
- 다른 도구용 `bd setup <도구>`: 그 도구의 설정 파일을 바꾼다. Claude용 `bd setup claude`와 `bd hooks install`은 이미 실행했다.
- `CLAUDE.md`의 `BEGIN BEADS`~`END BEADS` 블록 직접 수정: `bd setup`을 다시 실행하면 덮어쓴다. 우리 규칙은 `.claude/rules/beads.md`에 쓴다.
- `.beads/` 폴더 삭제: 장부가 사라진다. 복구할 곳이 없다.

## 기타

- 백업: `bd backup init <저장소 밖 폴더>`를 한 번 실행한 뒤, 필요할 때 `bd backup sync`.
- 프로젝트 사실 기억: `bd remember "내용" --key 영문-이름`. 한글만 쓰면 `--key` 없이는 실패한다.
- 옵션 없는 `bd doctor`는 이 저장 방식에서 지원되지 않고 `--check=conventions` 등 일부만 된다. 고장이 의심되면 `bd version`과 `bd list`를 먼저 본다.
- bd를 새로 설치하거나 올릴 때는 [공식 업그레이드 안내](https://beads.gascity.com/getting-started/upgrading)를 따른다.
- 제거(순서대로):
  1. 새 브랜치에서 `bd setup claude --remove`를 실행한다. `.claude/settings.json`의 SessionStart 훅과 `CLAUDE.md`의 BEADS 블록이 빠진다. 이 변경은 git에 추적되는 파일이므로 PR로 main에 반영해야 다른 체크아웃과 새 클론에서도 사라진다. 반영 전에 `bd.exe`를 지우면 그 환경에서 훅이 오류를 낸다.
  2. `bd hooks uninstall`로 `.git/hooks/`의 훅을 지운다.
  3. 아래 3개는 **주 저장소 폴더**(`C:\Users\chewo\Lighthouse_Dev`) 기준이다. 다른 worktree 폴더의 `.git`은 파일이라 `.git/info/exclude`가 없다. 주 저장소의 `.beads/` 폴더를 지우고, `.git/info/exclude`에서 `.beads/`와 `*.gate.lock*` 두 줄을 빼고, `.git/config`에서 `[beads]` 항목을 뺀다.
  4. 마지막에 `bd.exe`를 지운다.
