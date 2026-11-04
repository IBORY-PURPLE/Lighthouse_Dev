#!/usr/bin/env node
// guard.js 회귀 시험. 실행: node .claude/hooks/guard.test.js
// 임시 저장소 두 개(main, 기능 브랜치)로 커밋 차단을 확인한다. 네트워크를 쓰지 않는다.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GUARD = path.join(__dirname, 'guard.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));
const makeRepo = (name, branch) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
  if (branch !== 'main') git('checkout', '-q', '-b', branch);
  return dir.replace(/\\/g, '/');
};
const onMain = makeRepo('on-main', 'main');
const onFeat = makeRepo('on-feat', 'feat/x');

const ALLOW = 0;
const BLOCK = 2;
const heredoc = (body) => `gh pr create --body-file - <<'EOF'\n${body}\nEOF`;
const cases = [
  // 푸시
  ['Bash', 'git push github feat/stt', ALLOW],
  ['Bash', 'git push -u github feat/stt', ALLOW],
  ['Bash', 'git push github main', BLOCK],
  ['Bash', 'git push', BLOCK],
  ['Bash', 'git push origin feat/x', BLOCK],
  ['Bash', 'git push --force github feat/x', BLOCK],
  ['Bash', 'git push -f github feat/x', BLOCK],
  ['Bash', 'git push github +feat/x', BLOCK],
  ['Bash', 'git push github feat/x:main', BLOCK],
  ['Bash', 'git push github :feat/x', BLOCK],
  ['Bash', 'git push github HEAD', BLOCK],
  ['Bash', 'git -C . push github main', BLOCK],
  ['Bash', 'git status && git push github main', BLOCK],
  // 오탐 2: 출력 재지정
  ['Bash', 'git push -u github feat/x 2>&1 | tail -2', ALLOW],
  ['Bash', 'git push github feat/x > /dev/null', ALLOW],
  ['Bash', 'git push github main 2>&1', BLOCK],
  // 오탐 3: 글 안의 명령 예시
  ['Bash', heredoc('예: `git push github <브랜치> 2>&1`, git push --force, rm -rf /'), ALLOW],
  ['Bash', 'gh pr create --title t --body "git push origin main"', ALLOW],
  ['PowerShell', "git log @'\ngit push origin main\n'@", ALLOW],
  ['Bash', heredoc('본문') + '\ngit push github main', BLOCK],
  // 글을 코드로 넘기는 경우는 그대로 막는다
  ['Bash', 'bash -c "git push github main"', BLOCK],
  ['Bash', "sh -c 'git push --force github feat/x'", BLOCK],
  ['Bash', "bash <<'EOF'\ngit push github main\nEOF", BLOCK],
  ['Bash', "cat <<'EOF' | bash\ngit reset --hard\nEOF", BLOCK],
  // 경로가 붙은 인터프리터. 따옴표 안 금지 명령이 지워지면 안 된다.
  ['Bash', '/bin/bash -c "git push github main"', BLOCK],
  ['Bash', "/usr/bin/sh -c 'git reset --hard HEAD'", BLOCK],
  ['Bash', './bash -c "git push github main"', BLOCK],
  ['Bash', '/usr/bin/env /bin/bash -c "git push github main"', BLOCK],
  ['Bash', 'C:/Windows/System32/bash.exe -c "git push github main"', BLOCK],
  ['PowerShell', 'C:\\Windows\\System32\\bash.exe -c "git reset --hard"', BLOCK],
  ['Bash', "cat <<'EOF' | /bin/bash\ngit reset --hard\nEOF", BLOCK],
  ['Bash', '"/bin/bash" -c "git push github main"', BLOCK],
  ['Bash', "'/usr/bin/sh' -c 'git reset --hard'", BLOCK],
  ['Bash', '/bin/bash -c "echo ok"', ALLOW],
  ['Bash', 'echo "/bin/bash"', ALLOW],
  ['Bash', "git commit -m \"예: /bin/bash -c 'git push github main'\"", ALLOW, onFeat],
  ['Bash', 'git commit -m "bash"', ALLOW, onFeat],
  // .env
  ['Bash', 'cat .env', BLOCK],
  ['Bash', 'cat ".env"', BLOCK],
  ['Bash', 'git add .env', BLOCK],
  ['Bash', "cat > .env <<'EOF'\nA=1\nEOF", BLOCK],
  ['PowerShell', 'Get-Content .env', BLOCK],
  ['Bash', 'cat .env.example', ALLOW],
  ['Bash', 'git add .gitignore', ALLOW],
  // .env 글롭(Codex 리뷰 지적)
  ['Bash', 'cat .env.*', BLOCK],
  ['Bash', 'cat .env*', BLOCK],
  ['Bash', 'cat .en?', BLOCK],
  ['Bash', 'cat .e*', BLOCK],
  ['Bash', 'cat .*', BLOCK],
  ['Bash', 'cat config/.env.*', BLOCK],
  ['Bash', 'cat .env{,.local}', BLOCK],
  ['Bash', 'git add -f .env.*', BLOCK],
  ['Bash', 'git add --force secret.txt', BLOCK],
  ['Bash', 'ls src/*.ts', ALLOW],
  ['Bash', 'ls *', ALLOW],
  ['Bash', 'rm -rf .next/*', ALLOW],
  ['Bash', 'grep -E ".*" a.ts', ALLOW],
  ['Bash', 'git add -A', ALLOW],
  // Bugbot 1: 접미사가 여럿인 .env
  ['Bash', 'cat .env.development.local', BLOCK],
  ['Bash', 'git add .env.production.local', BLOCK],
  ['Bash', 'cat config/.env.test.local', BLOCK],
  ['Bash', 'cat .env.*.local', BLOCK],
  ['PowerShell', 'Get-Content ".env.development.local"', BLOCK],
  ['Bash', 'cat docs/env.md', ALLOW],
  ['Bash', 'cat .environment', ALLOW],
  // Bugbot 2: 경로를 붙인 인터프리터
  ['Bash', '/bin/bash -c "git push github main"', BLOCK],
  ['Bash', '/usr/bin/sh -c "git reset --hard"', BLOCK],
  ['Bash', '/usr/bin/env bash -c "git push github main"', BLOCK],
  ['Bash', 'C:/Git/bin/bash.exe -c "git push github main"', BLOCK],
  ['Bash', 'bash.exe -c "git clean -fd"', BLOCK],
  ['PowerShell', '& "C:\\Program Files\\Git\\bin\\bash.exe" -c "git push github main"', BLOCK],
  ['PowerShell', 'C:\\Git\\bin\\bash.exe -c "git reset --hard"', BLOCK],
  ['Bash', 'cmd /c "git push github main"', BLOCK],
  ['Bash', 'gh pr comment 1 --body "/bin/bash 설명"', ALLOW],
  ['Bash', 'ls scripts/bash', ALLOW],
  // 파괴적 명령
  ['Bash', 'git reset --hard HEAD', BLOCK],
  ['Bash', 'git reset --soft HEAD~1', ALLOW],
  ['Bash', 'git clean -fd', BLOCK],
  // Bugbot 4: 긴 옵션 clean
  ['Bash', 'git clean --force', BLOCK],
  ['Bash', 'git clean --force -d', BLOCK],
  ['Bash', 'git clean -n', ALLOW],
  ['Bash', 'git clean --dry-run', ALLOW],
  ['Bash', 'rm -rf /c/Users', BLOCK],
  ['Bash', 'rm -rf ../x', BLOCK],
  ['Bash', 'rm -rf node_modules', ALLOW],
  ['Bash', 'gh repo delete a/b', BLOCK],
  ['Bash', 'git commit --no-verify -m x', BLOCK],
  ['Bash', 'gh pr merge 3 --merge', BLOCK],
  ['Bash', 'npm run test', ALLOW],
  // 오탐 1: 커밋 대상 브랜치
  ['Bash', 'git commit -m x', BLOCK, onMain],
  ['Bash', 'git commit -m x', ALLOW, onFeat],
  ['Bash', `cd "${onFeat}" && git commit -m x`, ALLOW, onMain],
  ['Bash', `cd ${onMain} && git commit -m x`, BLOCK, onFeat],
  ['Bash', `git -C "${onFeat}" commit -m x`, ALLOW, onMain],
  ['Bash', `git -C ${onMain} commit -m x`, BLOCK, onFeat],
  ['Bash', `cd ${onFeat} && cd ${onMain} && git commit -m x`, BLOCK, onFeat],
  ['Bash', 'cd "$WHERE" && git commit -m x', BLOCK, onFeat],
  ['Bash', 'git commit -m "git push github main 설명"', ALLOW, onFeat],
  ['Bash', `git commit -F - <<'EOF'\ngit push github main 설명\nEOF`, ALLOW, onFeat],
  // Bugbot 3: 같은 명령 안의 브랜치 전환
  ['Bash', 'git checkout main && git commit -m x', BLOCK, onFeat],
  ['Bash', 'git switch main; git commit -m x', BLOCK, onFeat],
  ['Bash', 'git checkout master\ngit commit -m x', BLOCK, onFeat],
  ['Bash', 'git switch -q main && git commit -m x', BLOCK, onFeat],
  ['Bash', `git -C ${onFeat} checkout main && git -C ${onFeat} commit -m x`, BLOCK, onMain],
  ['Bash', `cd ${onFeat} && git switch main && git commit -m x`, BLOCK, onMain],
  ['Bash', 'git checkout - && git commit -m x', BLOCK, onFeat],
  ['Bash', 'git switch "$BRANCH" && git commit -m x', BLOCK, onFeat],
  ['Bash', 'git switch main && git switch feat/y && git commit -m x', ALLOW, onFeat],
  ['Bash', 'git checkout -b feat/y && git commit -m x', ALLOW, onMain],
  ['Bash', 'git switch -c feat/y && git commit -m x', ALLOW, onMain],
  ['Bash', 'git checkout feat/y && git commit -m x', ALLOW, onMain],
  ['Bash', 'git checkout -- src/a.ts && git commit -m x', ALLOW, onFeat],
  ['Bash', 'git checkout -- main && git commit -m x', ALLOW, onFeat],
  ['Bash', 'git switch main', ALLOW, onFeat],
  ['Bash', `git checkout main && git -C ${onFeat} commit -m x`, BLOCK, onFeat],
  // 파일 도구
  ['Read', { file_path: 'C:/x/.env' }, BLOCK],
  ['Read', { file_path: 'C:/x/.env.local' }, BLOCK],
  ['Read', { file_path: 'C:/x/.env.example' }, ALLOW],
  ['Read', { file_path: 'C:/x/a.ts' }, ALLOW],
  ['Read', { file_path: 'C:/x/.claude/hooks/guard.js' }, ALLOW],
  ['Write', { file_path: 'C:/x/.claude/settings.json' }, BLOCK],
  ['Edit', { file_path: 'C:\\x\\.claude\\hooks\\guard.js' }, BLOCK],
];

let failed = 0;
for (const [tool, input, want, cwd = onFeat] of cases) {
  const tool_input = typeof input === 'string' ? { command: input } : input;
  const r = spawnSync('node', [GUARD], {
    input: JSON.stringify({ tool_name: tool, tool_input, cwd }),
    encoding: 'utf8',
    cwd: tmp,
  });
  if (r.status !== want) {
    failed++;
    console.log(`FAIL 기대 ${want} 실제 ${r.status}: ${tool} ${JSON.stringify(input)}\n  ${r.stderr.trim()}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${cases.length - failed}/${cases.length} 통과`);
process.exit(failed ? 1 : 0);
