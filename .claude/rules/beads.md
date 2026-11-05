# beads(`bd`) 작업 추적

여러 세션에 걸치는 할 일과 그 순서를 `bd`로 관리한다. 사람용 안내는 `docs/beads-guide.md`다.

## 쓰는 법

- 세션 사이에 이어질 일, 순서가 걸린 일, 작업 중 발견한 후속 일을 이슈로 남긴다. 시작은 `bd ready`, 맡기는 `bd update <id> --claim`, 끝은 `bd close <id> --reason "한 일"`이다.
  - 이유: 다음 세션이 대화 없이 이어 간다. 어기면: 발견한 일이 대화와 함께 사라진다.
- `bd` 명령이 없는 환경(클라우드 세션 등)에서는 건너뛰고 진행 기록에 적는다.
  - 이유: 장부는 이 PC에만 있다. 어기면: 없는 도구를 찾느라 블록 시간을 쓴다.

## 기존 규칙이 우선

- `ai.md`, `progress.md`, `morning-report.md`, 메모리, 앱의 작업 목록은 그대로 쓴다. `bd`가 대신하지 않는다.
  - 이유: 새 세션의 진입점과 아침 보고가 이 파일들로 정해져 있다. 어기면: 다음 세션이 진행 상황을 못 찾는다.
- `bd prime` 출력(세션 시작 때 자동 주입)과 `CLAUDE.md`의 `BEGIN BEADS` 블록에 있는 "TodoWrite·TaskCreate·markdown 목록 금지", "MEMORY.md 금지", "세션 종료 때 커밋·푸시" 안내는 이 프로젝트에 적용하지 않는다. 앱의 작업 목록, 메모리, `progress.md`, `pr-flow.md`가 우선이다.
  - 이유: 범용 안내라 이 프로젝트 규칙을 모른다. 그 블록도 "저장소·이용자 지시가 우선"이라고 스스로 밝힌다. 어기면: 정해진 기록 방식이 깨지거나 허락 없이 커밋·푸시한다.
- `CLAUDE.md`의 `BEGIN BEADS`~`END BEADS` 블록은 고치지 않는다. 우리 규칙은 이 파일에 쓴다.
  - 이유: `bd setup`이 다시 돌면 블록을 덮어쓴다. 어기면: 고친 내용이 조용히 사라진다.

## 금지

- `bd dolt push`, `bd dolt remote add`, `bd backup init`으로 원격 지정, `bd init --reinit-local`(`--force`), 다른 도구용 `bd setup <도구>`, `bd setup claude --remove`, `bd hooks uninstall`을 이용자 허락 없이 실행하지 않는다. Claude용 `bd setup claude`와 `bd hooks install`은 이용자 요청으로 이미 실행했다.
  - 이유: `bd`는 금지된 `origin`을 동기화 기본 후보로 잡고, `--reinit-local`은 장부를 덮어쓰며, `bd setup`류와 훅 명령은 Claude 설정과 git 훅을 바꾼다. 어기면: 금지선을 `git` 명령 없이 넘어서 `guard.js`도 막지 못한다.
- `.beads/` 파일을 커밋하거나 지우지 않는다.
  - 이유: 이 PC 전용 데이터이고 다른 복사본이 없다. 어기면: 저장소가 무거워지거나 장부를 잃는다.
