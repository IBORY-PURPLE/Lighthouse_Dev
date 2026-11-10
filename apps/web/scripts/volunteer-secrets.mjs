#!/usr/bin/env node
// 봉사자 계정 1개의 비밀값 3줄을 만든다. 사람이 자기 터미널에서만 실행한다.
// 출력은 `apps/web/.env.local`과 Vercel 환경 변수에 붙여 넣는다. 저장소·채팅·AI에는 주지 않는다.
//
//   node apps/web/scripts/volunteer-secrets.mjs
//
// 형식(서버 `src/lib/volunteerAuth.ts`와 같아야 한다):
//   VOLUNTEER_PHONE           숫자만(예: 010으로 시작하는 11자리)
//   VOLUNTEER_PASSWORD_HASH   scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>
//   VOLUNTEER_SESSION_SECRET  32바이트 base64url
// 구분자로 `$`를 쓰지 않는다. Next.js가 .env 값의 `$이름`을 변수로 바꿔 해시가 깨진다.

import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const MIN_PASSWORD_LENGTH = 12;

function createPrompter() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });
  let muted = false;
  // 비밀번호를 칠 때 화면에 글자를 찍지 않는다.
  rl._writeToOutput = (text) => {
    if (!muted) rl.output.write(text);
  };
  // 줄을 버퍼에 모아 읽는다. 붙여 넣기나 파이프로 여러 줄이 한꺼번에 와도 잃지 않는다.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question, { hidden = false } = {}) => {
    process.stdout.write(question);
    muted = hidden;
    const { value, done } = await lines.next();
    muted = false;
    if (hidden) process.stdout.write("\n");
    return done ? "" : value;
  };
  return { ask, close: () => rl.close() };
}

export function normalizePhone(input) {
  return String(input).replace(/\D/g, "");
}

export function isValidPhone(digits) {
  return /^01\d{8,9}$/.test(digits);
}

export function hashPassword(password, salt = randomBytes(16)) {
  const { N, r, p, keylen } = SCRYPT;
  const hash = scryptSync(password, salt, keylen, { N, r, p });
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(":");
}

async function main() {
  console.log("봉사자 계정 비밀값 만들기 (입력한 값은 어디에도 저장하지 않습니다)\n");
  const { ask, close } = createPrompter();
  const fail = (message) => {
    close();
    console.error(message);
    process.exit(1);
  };

  const phone = normalizePhone(await ask("전화번호(숫자만, 예: 01012345678): "));
  if (!isValidPhone(phone)) {
    fail("전화번호 형식이 아닙니다. 01로 시작하는 10~11자리 숫자를 넣어 주세요.");
  }

  const password = await ask(`비밀번호(${MIN_PASSWORD_LENGTH}자 이상, 화면에 안 보임): `, {
    hidden: true,
  });
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`비밀번호가 ${MIN_PASSWORD_LENGTH}자보다 짧습니다.`);
  }
  const again = await ask("비밀번호 한 번 더: ", { hidden: true });
  close();
  if (again !== password) {
    fail("두 비밀번호가 다릅니다. 처음부터 다시 실행해 주세요.");
  }

  const lines = [
    `VOLUNTEER_PHONE=${phone}`,
    `VOLUNTEER_PASSWORD_HASH=${hashPassword(password)}`,
    `VOLUNTEER_SESSION_SECRET=${randomBytes(32).toString("base64url")}`,
  ];

  console.log("\n아래 3줄을 apps/web/.env.local 끝에 붙여 넣고, 같은 값을 Vercel 환경 변수에 등록하세요.");
  console.log("이 3줄은 채팅이나 AI에게 보내지 마세요.\n");
  console.log(lines.join("\n"));
  console.log("");
}

// 시험에서 함수만 가져다 쓸 때는 실행하지 않는다.
const invokedDirectly =
  process.argv[1] &&
  import.meta.url.toLowerCase().endsWith(
    process.argv[1].replace(/\\/g, "/").split("/").pop().toLowerCase(),
  );
if (invokedDirectly) {
  main().catch((error) => {
    console.error("실패:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
