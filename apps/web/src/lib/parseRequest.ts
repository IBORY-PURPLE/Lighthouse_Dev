// 이용자 문장을 AI 없이 사전으로 분석한다. TSD §8.
// 부분 일치로 찾아서 "소니껄로"처럼 조사가 붙어도 찾는다.

const BRANDS = [{ name: "Sony", pattern: /sony|소니|쏘니/i }];
const ITEMS = [{ name: "헤드셋", pattern: /헤드셋|헤드폰/ }];

export interface ParsedRequest {
  brand: string | null;
  item: string | null;
}

function findName(
  text: string,
  entries: readonly { name: string; pattern: RegExp }[],
): string | null {
  return entries.find((entry) => entry.pattern.test(text))?.name ?? null;
}

export function parseRequest(text: string): ParsedRequest {
  return { brand: findName(text, BRANDS), item: findName(text, ITEMS) };
}
