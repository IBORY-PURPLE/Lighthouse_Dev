#!/usr/bin/env node
// PreToolUse 훅. 무인 실행의 금지선을 실행 전에 막는다. 종료 코드 2 = 차단.
// 패턴 기반이라 전부 막지는 못한다. 규칙 원문은 .claude/rules/overnight-loop.md.
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const block = (why) => {
  process.stderr.write(`[guard] 차단: ${why}. 우회하지 말고 progress.md에 기록한 뒤 다른 방법을 찾거나 멈추세요.\n`);
  process.exit(2);
};
const isEnvFile = (p) => {
  const base = path.basename(String(p || '').replace(/\\/g, '/'));
  return /^\.env(\..+)?$/.test(base) && base !== '.env.example';
};
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// 명령 해석을 위한 글 정리. 글 안의 명령 예시를 실제 명령으로 읽지 않으려는 것이다.
const stripHeredocs = (s) =>
  s
    .replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g, ' $3')
    .replace(/@'\r?\n[\s\S]*?\r?\n'@|@"\r?\n[\s\S]*?\r?\n"@/g, '""');
const stripQuotes = (s) => s.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
const stripRedirects = (s) => s.replace(/(^|\s)\d*(?:&?>>?|<)(?:&\d+|\s*[^\s;&|]+)/g, ' ');
// 글을 다른 프로그램에 코드로 넘기는 명령이면 글을 지우지 않고 그대로 검사한다.
// 경로가 붙은 호출(/bin/bash, .\bash.exe)도 이름만 있는 호출과 같이 본다.
const INTERP = String.raw`bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|node|python\d*|perl|ruby|eval|iex|Invoke-Expression`;
const RUNS_TEXT = new RegExp(
  String.raw`(^|[\s;&|(])(?:[^\s;&|()'"]*[/\\])?(?:${INTERP})(?:\.exe)?(?=$|[\s;&|)])`,
  'i',
);
// 따옴표 안 경로에는 공백이 있을 수 있다(C:\Program Files\...).
const INTERP_WORD = new RegExp(String.raw`^(?:[^;&|()'"]*[/\\])?(?:${INTERP})(?:\.exe)?$`, 'i');
// 따옴표만 두른 실행 파일은 판별 전에 드러낸다. 문장 안 예시는 통째로 따옴표 안이라 그대로 둔다.
const revealQuotedInterpreters = (s) =>
  s.replace(/(^|[\s;&|(])(["'])([^"']+)\2(?=$|[\s;&|)])/g, (all, pre, _q, body) =>
    INTERP_WORD.test(body) ? pre + body : all);

// 접미사 개수와 상관없이 .env 파일 이름을 찾는다. isEnvFile과 같은 기준이다.
const hasEnvName = (s) => {
  for (const m of s.matchAll(/(?:^|[\s"'=/\\<>])(\.env(?:\.[\w-]+)*)(?=$|[\s"';&|<>)])/gm)) {
    if (m[1] !== '.env.example') return true;
  }
  return false;
};

// 셸이 펼치면 .env 파일에 닿는 글롭인지 본다. 점으로 시작하는 패턴만 숨김 파일과 맞는다.
const ENV_NAMES = [
  '.env', '.env.local', '.env.development', '.env.production', '.env.test',
  '.env.development.local', '.env.production.local', '.env.test.local',
];
function globHitsEnv(s) {
  if (/\.env\{/.test(s)) return true;
  return s.split(/[\s;&|()<>=]+/).some((token) => {
    const base = token.replace(/["']/g, '').split(/[\\/]/).pop();
    if (!base.startsWith('.') || !/[*?[]/.test(base)) return false;
    const source = base
      .replace(/[.+^$(){}|\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    try {
      const re = new RegExp(`^${source}$`);
      return ENV_NAMES.some((name) => re.test(name));
    } catch {
      return true;
    }
  });
}

function resolveDir(base, raw) {
  const arg = raw.replace(/^["']|["']$/g, '');
  if (/[$`%]/.test(arg)) block('커밋 대상 폴더를 확인하지 못함');
  let p = arg.replace(/^~(?=$|[\\/])/, os.homedir());
  if (process.platform === 'win32') p = p.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:');
  return path.resolve(base, p);
}

// checkout·switch 뒤의 브랜치. 바뀌지 않으면 undefined, 알 수 없으면 null이다.
function switchedBranch(args) {
  const clean = (w) => (w === undefined ? null : w.replace(/^["']|["']$/g, ''));
  const words = args.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (/^(-[bBcC]|--create|--force-create|--orphan)$/.test(words[i])) return clean(words[i + 1]);
  }
  if (words.includes('--')) return undefined; // 파일 되돌리기
  const name = words.find((w) => !w.startsWith('-') || w === '-');
  if (name === undefined) return undefined;
  return name === '-' || /[$`%]/.test(name) ? null : clean(name);
}

function checkCommitBranches(text, base) {
  const QUOTED = String.raw`"[^"]*"|'[^']*'`;
  const re = new RegExp(
    String.raw`(?:^|[\s;&|(])(?:cd|Set-Location|sl|pushd)\s+(${QUOTED}|[^\s;&|)]+)` +
      String.raw`|\bgit((?:\s+-[cC]\s+(?:${QUOTED}|\S+)|\s+--[\w-]+(?:=\S+)?)*)\s+(commit|checkout|switch)\b([^;&|\n]*)`,
    'g',
  );
  let dir = path.resolve(base);
  const switched = new Map(); // 같은 명령 안에서 브랜치를 바꾼 폴더
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) {
      dir = resolveDir(dir, m[1]);
      continue;
    }
    const opt = (m[2] || '').match(new RegExp(String.raw`(?:^|\s)-C\s+(${QUOTED}|\S+)`));
    const target = opt ? resolveDir(dir, opt[1]) : dir;
    if (m[3] !== 'commit') {
      const next = switchedBranch(m[4]);
      if (next !== undefined) switched.set(target, next);
      continue;
    }
    let branch = switched.get(target);
    if (branch === undefined && !switched.has(target)) {
      try {
        branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], target);
      } catch {
        block('커밋 대상 브랜치를 확인하지 못함');
      }
    }
    if (branch === null) block('커밋 대상 브랜치를 확인하지 못함');
    if (branch === 'main' || branch === 'master') block('main 직접 커밋. 기능 브랜치에서 작업');
  }
}

function checkPush(args) {
  const words = args.trim().split(/\s+/).map((w) => w.replace(/^["']+|["']+$/g, '')).filter(Boolean);
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

function checkMerge(args, base) {
  if (!/--squash\b/.test(args)) block('병합은 --squash만 허용');
  const words = args.trim().split(/\s+/).filter(Boolean);
  const viewArgs = [];
  let target;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '-R' || w === '--repo') viewArgs.push('-R', words[++i]);
    else if (w.startsWith('--repo=')) viewArgs.push('-R', w.slice(7));
    else if (!w.startsWith('-') && w !== '""' && target === undefined) target = w;
  }
  let info;
  try {
    info = JSON.parse(run('gh', ['pr', 'view', ...(target ? [target] : []), ...viewArgs, '--json', 'labels,baseRefName'], base));
  } catch {
    block('PR 상태를 확인하지 못해 병합 불가');
  }
  const names = info.labels.map((l) => l.name);
  const reviewed = names.includes('reviewed-ok');
  if (info.baseRefName !== 'main' && !reviewed) block('main이 base가 아닌 쌓인 PR은 사람이 점검(reviewed-ok) 후 병합');
  if (names.includes('hold-morning') && !reviewed) block('hold-morning PR은 사람이 점검(reviewed-ok) 후 병합');
}

function checkShell(raw, base) {
  const noHeredoc = stripHeredocs(raw);
  const runsText = RUNS_TEXT.test(stripQuotes(revealQuotedInterpreters(noHeredoc)));
  const text = runsText ? raw : noHeredoc;
  const cmd = stripRedirects(runsText ? raw : stripQuotes(noHeredoc));
  const GIT = String.raw`\bgit(?:\s+-[cC]\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+`;
  const sub = (name) => new RegExp(GIT + name + String.raw`\b([^;&|\n]*)`, 'g');

  if (hasEnvName(text)) block('.env 접근');
  if (globHitsEnv(runsText ? raw : stripQuotes(noHeredoc))) block('.env에 닿는 글롭');
  for (const m of cmd.matchAll(sub('add'))) if (/(^|\s)(-[a-zA-Z]*f[a-zA-Z]*|--force)(?=\s|$)/.test(m[1])) block('무시 파일 강제 추가');
  if (/\b(printenv)\b/.test(cmd)) block('환경 변수 전체 출력');
  for (const m of cmd.matchAll(sub('push'))) checkPush(m[1]);
  for (const m of cmd.matchAll(sub('reset'))) if (/--hard\b/.test(m[1])) block('git reset --hard');
  for (const m of cmd.matchAll(sub('clean'))) if (/(^|\s)(-[a-zA-Z]*f|--force)/.test(m[1])) block('git clean -f');
  for (const m of cmd.matchAll(sub('branch'))) if (/\s-D\b.*\b(main|master)\b/.test(m[1])) block('main 브랜치 삭제');
  for (const m of cmd.matchAll(sub('(?:config|remote)'))) if (/\b(core\.hooksPath|set-url|remove)\b/.test(m[1])) block('저장소 원격·훅 설정 변경');
  if (/--no-verify\b/.test(cmd)) block('검사 건너뛰기');
  if (/\bgh\s+repo\s+(delete|archive|edit)\b/.test(cmd)) block('저장소 변경');
  if (/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s+|-[a-zA-Z]*\s+)*(\/|~|\.\.|[A-Za-z]:)/.test(cmd)) block('저장소 밖 삭제');
  if (/\bRemove-Item\b[^;&|\n]*(\s|=)(~|\.\.|\/|[A-Za-z]:)/i.test(text)) block('저장소 밖 삭제');
  for (const m of cmd.matchAll(/\bgh\s+pr\s+merge\b([^;&|\n]*)/g)) checkMerge(m[1], base);
  if (sub('commit').test(cmd)) checkCommitBranches(text, base);
}

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let event;
  try { event = JSON.parse(input); } catch { process.exit(0); }
  const tool = event.tool_name;
  const ti = event.tool_input || {};
  if (tool === 'Bash' || tool === 'PowerShell') checkShell(String(ti.command || ''), event.cwd || process.cwd());
  else if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(tool)) {
    if (isEnvFile(ti.file_path || ti.notebook_path)) block('.env 접근');
    const p = String(ti.file_path || '').replace(/\\/g, '/');
    if (tool !== 'Read' && /\.claude\/(hooks\/|settings(\.local)?\.json)/.test(p)) block('안전 훅·설정 변경');
  } else if (tool === 'Grep' && isEnvFile(ti.path)) block('.env 접근');
  process.exit(0);
});
