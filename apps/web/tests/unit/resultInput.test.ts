import { describe, expect, it } from "vitest";
import { checkCandidate, isHttpsLink, parseResultBody, RESULT_LIMITS } from "@/lib/resultInput";

const good = () => ({
  name: "소니 WH-CH720N",
  url: "https://search.11st.co.kr/pc/total-search?kwd=x",
  guide: "구매하기를 누르고 색상을 고릅니다.",
  summary: [{ label: "옵션", value: "블랙" }],
});

describe("결과 한도(resultInput)", () => {
  it("한도 값은 계획과 같다", () => {
    expect(RESULT_LIMITS).toMatchObject({
      maxCandidates: 3,
      nameMax: 100,
      urlMax: 2048,
      guideMax: 1000,
      summaryMax: 12,
      labelMax: 30,
      valueMax: 200,
    });
  });

  it("후보 1~3개는 통과하고 값은 앞뒤 공백을 자른다", () => {
    for (const count of [1, 2, 3]) {
      const result = parseResultBody({ candidates: Array.from({ length: count }, good) });
      expect(result).toMatchObject({ ok: true });
      expect(result.ok && result.candidates).toHaveLength(count);
    }
    const trimmed = checkCandidate({ ...good(), name: "  이름  ", guide: " 가이드 " });
    expect(trimmed).toEqual({
      ok: true,
      candidate: { ...good(), name: "이름", guide: "가이드" },
    });
  });

  it("후보 0개는 invalid_request, 4개는 too_long, 목록이 아니면 invalid_request", () => {
    expect(parseResultBody({ candidates: [] })).toEqual({ ok: false, error: "invalid_request" });
    expect(parseResultBody({ candidates: Array.from({ length: 4 }, good) })).toEqual({
      ok: false,
      error: "too_long",
    });
    for (const body of [null, {}, { candidates: "x" }, [], "x"]) {
      expect(parseResultBody(body)).toEqual({ ok: false, error: "invalid_request" });
    }
  });

  it("이름: 100자는 통과, 101자는 too_long, 빈 이름은 invalid_request", () => {
    expect(checkCandidate({ ...good(), name: "가".repeat(100) }).ok).toBe(true);
    expect(checkCandidate({ ...good(), name: "가".repeat(101) })).toEqual({ ok: false, error: "too_long" });
    expect(checkCandidate({ ...good(), name: "   " })).toEqual({ ok: false, error: "invalid_request" });
  });

  it("링크: http·글자·URL이 아닌 값은 invalid_url, 2048자는 통과, 2049자는 too_long", () => {
    for (const url of ["http://shop.example/a", "shop.example", "https://", "javascript:alert(1)", ""]) {
      expect(checkCandidate({ ...good(), url })).toEqual({ ok: false, error: "invalid_url" });
    }
    const prefix = "https://shop.example/";
    expect(checkCandidate({ ...good(), url: prefix + "a".repeat(2048 - prefix.length) }).ok).toBe(true);
    expect(checkCandidate({ ...good(), url: prefix + "a".repeat(2049 - prefix.length) })).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(isHttpsLink("https://a.example")).toBe(true);
    expect(isHttpsLink("http://a.example")).toBe(false);
  });

  it("가이드: 비워도 되고 1000자는 통과, 1001자는 too_long", () => {
    expect(checkCandidate({ ...good(), guide: "" }).ok).toBe(true);
    expect(checkCandidate({ ...good(), guide: "가".repeat(1000) }).ok).toBe(true);
    expect(checkCandidate({ ...good(), guide: "가".repeat(1001) })).toEqual({ ok: false, error: "too_long" });
  });

  it("요약 항목: 12개는 통과, 13개는 too_long. 이름 30자·값 200자 한도, 빈 값은 invalid_request", () => {
    const items = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ label: `항목${index}`, value: "값" }));
    expect(checkCandidate({ ...good(), summary: items(12) }).ok).toBe(true);
    expect(checkCandidate({ ...good(), summary: items(13) })).toEqual({ ok: false, error: "too_long" });
    expect(checkCandidate({ ...good(), summary: [] }).ok).toBe(true);
    expect(checkCandidate({ ...good(), summary: [{ label: "가".repeat(31), value: "x" }] })).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(checkCandidate({ ...good(), summary: [{ label: "옵션", value: "가".repeat(201) }] })).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(checkCandidate({ ...good(), summary: [{ label: "옵션", value: "가".repeat(200) }] }).ok).toBe(true);
    for (const pair of [{ label: "", value: "x" }, { label: "옵션", value: " " }, { label: 1, value: "x" }, null]) {
      expect(checkCandidate({ ...good(), summary: [pair] })).toEqual({ ok: false, error: "invalid_request" });
    }
  });

  it("이미지·읽은 글자·근거 같은 다른 속성은 결과에 옮겨지지 않는다", () => {
    const result = checkCandidate({
      ...good(),
      image: "data:image/png;base64,AAAA",
      text: "읽은 글자 원문",
      evidence: "근거 문장",
      summary: [{ label: "옵션", value: "블랙", evidence: "근거 문장" }],
    });
    expect(result).toEqual({ ok: true, candidate: good() });
    expect(JSON.stringify(result)).not.toMatch(/data:image|읽은 글자|근거/);
  });
});
