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
  // 파괴적 명령
  ['Bash', 'git reset --hard HEAD', BLOCK],
  ['Bash', 'git reset --soft HEAD~1', ALLOW],
  ['Bash', 'git clean -fd', BLOCK],
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
