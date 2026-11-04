#!/usr/bin/env node
// PreToolUse 훅. 무인 실행의 금지선을 실행 전에 막는다. 종료 코드 2 = 차단.
// 패턴 기반이라 전부 막지는 못한다. 규칙 원문은 .claude/rules/overnight-loop.md.
const { execFileSync } = require('child_process');
const path = require('path');

const block = (why) => {
  process.stderr.write(`[guard] 차단: ${why}. 우회하지 말고 progress.md에 기록한 뒤 다른 방법을 찾거나 멈추세요.\n`);
  process.exit(2);
};
const isEnvFile = (p) => {
  const base = path.basename(String(p || '').replace(/\\/g, '/'));
  return /^\.env(\..+)?$/.test(base) && base !== '.env.example';
};
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function checkPush(args) {
  const words = args.trim().split(/\s+/).filter(Boolean);
  if (words.some((w) => /^(--force(-with-lease)?(=.*)?|--force-if-includes|-[a-zA-Z]*f[a-zA-Z]*)$/.test(w))) block('강제 푸시');
  if (words.some((w) => /^(--all|--mirror|--tags|--delete|-d)$/.test(w))) block('푸시 범위가 기능 브랜치를 넘음');
  const positional = words.filter((w) => !w.startsWith('-'));
  if (positional[0] !== 'github') block('푸시는 `git push github <브랜치>` 형식만 허용');
  const refs = positional.slice(1);
  if (refs.length !== 1) block('푸시할 브랜치를 하나 명시해야 함');
  const ref = refs[0];
  if (ref.startsWith('+') || ref.startsWith(':')) block('강제·삭제 푸시');
  const dest = ref.includes(':') ? ref.split(':')[1] : ref;
  if (/^(refs\/heads\/)?(main|master)$/.test(dest)) block('main 푸시');
  if (dest === 'HEAD') block('HEAD 푸시 대신 브랜치 이름을 명시해야 함');
}

function checkMerge(args) {
  if (!/--squash\b/.test(args)) block('병합은 --squash만 허용');
  const target = args.trim().split(/\s+/).find((w) => w && !w.startsWith('-'));
  let info;
  try {
    info = JSON.parse(run('gh', ['pr', 'view', ...(target ? [target] : []), '--json', 'labels,baseRefName']));
  } catch {
    block('PR 상태를 확인하지 못해 병합 불가');
  }
  if (info.baseRefName !== 'main') block('main이 base가 아닌 쌓인 PR은 사람이 병합');
  if (info.labels.some((l) => l.name === 'hold-morning')) block('hold-morning PR은 사람이 병합');
}

function checkShell(raw) {
  // 따옴표 안 글(커밋 메시지 등)은 명령으로 보지 않는다.
  const cmd = raw.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  const GIT = String.raw`\bgit(?:\s+-[cC]\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+`;
  const sub = (name) => new RegExp(GIT + name + String.raw`\b([^;&|\n]*)`, 'g');

  if (/(^|[\s"'=/\\<>])\.env(?!\.example)(\.[\w-]+)?(?=$|[\s"';&|<>)])/m.test(raw)) block('.env 접근');
  if (/\b(printenv)\b/.test(cmd)) block('환경 변수 전체 출력');
  for (const m of cmd.matchAll(sub('push'))) checkPush(m[1]);
  if (sub('reset').test(cmd) && /--hard\b/.test(cmd)) block('git reset --hard');
  for (const m of cmd.matchAll(sub('clean'))) if (/(^|\s)-[a-zA-Z]*f/.test(m[1])) block('git clean -f');
  for (const m of cmd.matchAll(sub('branch'))) if (/\s-D\b.*\b(main|master)\b/.test(m[1])) block('main 브랜치 삭제');
  for (const m of cmd.matchAll(sub('(?:config|remote)'))) if (/\b(core\.hooksPath|set-url|remove)\b/.test(m[1])) block('저장소 원격·훅 설정 변경');
  if (/--no-verify\b/.test(cmd)) block('검사 건너뛰기');
  if (/\bgh\s+repo\s+(delete|archive|edit)\b/.test(cmd)) block('저장소 변경');
  if (/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s+|-[a-zA-Z]*\s+)*(\/|~|\.\.|[A-Za-z]:)/.test(cmd)) block('저장소 밖 삭제');
  if (/\bRemove-Item\b[^;&|\n]*(\s|=)(~|\.\.|\/|[A-Za-z]:)/i.test(raw)) block('저장소 밖 삭제');
  for (const m of cmd.matchAll(/\bgh\s+pr\s+merge\b([^;&|\n]*)/g)) checkMerge(m[1]);

  if (sub('commit').test(cmd)) {
    let branch = '';
    try { branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']); } catch {}
    if (branch === 'main' || branch === 'master') block('main 직접 커밋. 기능 브랜치에서 작업');
  }
}

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let event;
  try { event = JSON.parse(input); } catch { process.exit(0); }
  const tool = event.tool_name;
  const ti = event.tool_input || {};
  if (tool === 'Bash' || tool === 'PowerShell') checkShell(String(ti.command || ''));
  else if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(tool)) {
    if (isEnvFile(ti.file_path || ti.notebook_path)) block('.env 접근');
    const p = String(ti.file_path || '').replace(/\\/g, '/');
    if (tool !== 'Read' && /\.claude\/(hooks\/|settings(\.local)?\.json)/.test(p)) block('안전 훅·설정 변경');
  } else if (tool === 'Grep' && isEnvFile(ti.path)) block('.env 접근');
  process.exit(0);
});
