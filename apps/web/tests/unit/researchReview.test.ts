import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addPhoto,
  cachedHelp,
  draftSummaryText,
  dropStaleSummary,
  effectivePhotoKind,
  emptyResearchState,
  fillSummary,
  guideSource,
  helpKey,
  isHttpsUrl,
  isResearchResponse,
  isSummaryStale,
  isVerified,
  parseStoredState,
  RESEARCH_COPY,
  RESEARCH_LIMITS,
  setSummaryText,
  withHelp,
  withPurchase,
  type ResearchPhoto,
  type ResearchResponse,
  type ResearchState,
} from "@/lib/research";
import { fallbackResponse, hasBrandWord, knownBrandIn } from "@/lib/researchAi";
import { demoCandidatesFor } from "@/lib/demoCandidates";
import { hasForbidden } from "@/lib/researchCheck";
import { buildResultBody, clip } from "@/lib/researchResult";
import { parseResultBody } from "@/lib/resultInput";

// 리뷰 반영(review-fixes.md F1·F4·F6·F10·F11·F12)과 화면 코드 리뷰 지적의 단위 시험.

const THUMB = "data:image/jpeg;base64,AAAA";

function ready(patch: Partial<ResearchState> = {}): ResearchState {
  return {
    ...emptyResearchState(),
    model: "소니 WH-CH720N",
    purchase: "bought",
    pros: "가벼워요",
    alts: ["소니 WH-CH520"],
    altReason: "무게를 봤어요",
    photos: [{ kind: "proof", thumb: THUMB, description: "" }],
    ...patch,
  };
}

describe("F1: 링크 주소가 200자 근처여도 보내기 본문이 서버 검사를 통과한다", () => {
  const urlOfLength = (length: number) => {
    const head = "https://shop.example/";
    return head + "a".repeat(length - head.length);
  };

  it.each([190, 197, 198, 199, 200])("주소 %i자 + 제목 '혜택 안내'", (length) => {
    const url = urlOfLength(length);
    expect([...url]).toHaveLength(length);
    const state = ready({ checked: { benefits: [{ title: "혜택 안내", url }], refs: [] } });
    const body = buildResultBody(state);
    expect(body).not.toBeNull();
    const entry = body!.candidates[0].summary.find((item) => item.label === "혜택 링크 1");
    expect(entry, `${length}자`).toBeDefined();
    expect([...entry!.value].length).toBeLessThanOrEqual(200);
    expect(entry!.value.endsWith(url)).toBe(true);
    // 제목 자리가 없으면(199·200자) 주소만 들어간다
    if (length >= 199) expect(entry!.value).toBe(url);
    // 서버의 결과 검사(parseResultBody)가 통과시킨다
    expect(parseResultBody(JSON.parse(JSON.stringify(body)))).toMatchObject({ ok: true });
  });

  it("주소가 201자면 그 링크는 빠지고 나머지는 보낼 수 있다", () => {
    const url = urlOfLength(201);
    const body = buildResultBody(ready({ checked: { benefits: [{ title: "혜택 안내", url }], refs: [] } }));
    expect(body!.candidates[0].summary.some((item) => item.label.startsWith("혜택 링크"))).toBe(false);
    expect(parseResultBody(JSON.parse(JSON.stringify(body)))).toMatchObject({ ok: true });
  });

  it("clip은 한도가 1 미만이면 빈 글자다", () => {
    expect(clip("가나다", 0)).toBe("");
    expect(clip("가나다", -3)).toBe("");
    expect(clip("가나다", 1)).toBe("…");
    expect(clip("가나다", 3)).toBe("가나다");
  });
});

describe("F4: 핵심 정리 글이 앞 답과 어긋난 채 보내지지 않는다", () => {
  it("AI·기본 초안은 입력이 바뀌면 낡은 글이 되고, 요약 단계에 들어올 때 비워진다", () => {
    let state = ready();
    state = fillSummary(state, "소니 WH-CH720N은 가벼워요.", "ai");
    expect(state.summarySource).toBe("ai");
    expect(isSummaryStale(state)).toBe(false);
    expect(guideSource(state)).toBe("소니 WH-CH720N은 가벼워요.");

    // 카드 1로 돌아가 기종을 고친다
    const edited = { ...state, model: "소니 WH-CH520" };
    expect(isSummaryStale(edited)).toBe(true);
    // 요약을 보지 않고 보내도 옛 글이 가이드가 되지 않는다(지금 답으로 만든 기본 글)
    expect(guideSource(edited)).toBe(draftSummaryText(edited));
    expect(guideSource(edited)).toContain("소니 WH-CH520");
    expect(guideSource(edited)).not.toContain("WH-CH720N");
    const body = buildResultBody(edited);
    expect(body!.candidates[0].guide).toContain("추천 기종: 소니 WH-CH520");

    const cleared = dropStaleSummary(edited);
    expect(cleared.summaryText).toBe("");
    expect(cleared.summarySource).toBe("none");
  });

  it("봉사자가 직접 고친 글은 입력이 바뀌어도 남고, AI 초안으로 덮이지 않는다", () => {
    let state = fillSummary(ready(), "AI 초안", "ai");
    state = setSummaryText(state, "내가 고친 글");
    expect(state.summarySource).toBe("volunteer");
    const edited = { ...state, model: "소니 WH-CH520" };
    expect(isSummaryStale(edited)).toBe(false);
    expect(dropStaleSummary(edited)).toBe(edited);
    expect(fillSummary(edited, "새 AI 초안", "ai")).toBe(edited);
    expect(fillSummary(edited, "새 기본 초안", "draft")).toBe(edited);
    expect(guideSource(edited)).toBe("내가 고친 글");
  });

  it("글 칸을 비우면 다시 초안을 받을 수 있다", () => {
    let state = setSummaryText(ready(), "내가 쓴 글");
    state = setSummaryText(state, "  ");
    expect(state.summarySource).toBe("none");
    expect(fillSummary(state, "AI 초안", "ai").summaryText).toBe("AI 초안");
  });

  it("기본 글(draft)은 AI 글로 바뀌지만, 지금 답에 맞는 AI 글을 기본 글이 덮지 않는다", () => {
    let state = fillSummary(ready(), "기본 글", "draft");
    expect(state.summarySource).toBe("draft");
    state = fillSummary(state, "AI 글", "ai");
    expect(state.summaryText).toBe("AI 글");
    expect(fillSummary(state, "기본 글", "draft").summaryText).toBe("AI 글");
  });

  it("응답이 늦게 와서 요청 때의 키가 지금 입력과 다르면 채우지 않는다", () => {
    const state = ready();
    const oldKey = helpKey(state, "summary");
    const changed = { ...state, pros: "다른 장점" };
    expect(fillSummary(changed, "옛 입력으로 만든 글", "ai", oldKey)).toBe(changed);
  });

  it("저장 모양에 출처가 없으면 글이 있을 때 봉사자 글로 읽는다", () => {
    const old = parseStoredState(JSON.stringify({ ...ready(), summarySource: undefined, summaryKey: undefined, summaryText: "옛 글" }));
    expect(old?.summarySource).toBe("volunteer");
    const empty = parseStoredState(JSON.stringify({ ...ready(), summarySource: "ai", summaryText: "" }));
    expect(empty?.summarySource).toBe("none");
    const ai = parseStoredState(JSON.stringify(fillSummary(ready(), "AI 글", "ai")));
    expect(ai?.summarySource).toBe("ai");
    expect(ai && isSummaryStale(ai)).toBe(false);
  });
});

describe("F6: 응답이 늦게 와도 옛 입력의 도움이 새 입력의 캐시가 되지 않는다", () => {
  const reply: ResearchResponse = {
    kind: "alts",
    ai: "ok",
    items: [{ name: "옛 기종의 대안", note: "", url: null, origin: "web" }],
  };

  it("요청 때의 키로 저장하면 기종이 바뀐 뒤에는 cachedHelp가 null이다", () => {
    const requested = ready({ model: "기종 A" });
    const key = helpKey(requested, "alts");
    // 응답이 오기 전에 기종을 B로 고쳤다
    const now = { ...requested, model: "기종 B" };
    const stored = withHelp(now, "alts", reply, key);
    expect(cachedHelp(stored, "alts")).toBeNull();
    // 다시 A로 돌아오면 그 응답이 쓰인다
    expect(cachedHelp({ ...stored, model: "기종 A" }, "alts")).toEqual(reply);
  });

  it("키를 주지 않으면 지금 입력의 키로 저장한다(기존 동작)", () => {
    const state = withHelp(ready(), "alts", reply);
    expect(cachedHelp(state, "alts")).toEqual(reply);
  });
});

describe("F10: 구매 여부를 바꿔도 착샷 표시가 사라지지 않는다", () => {
  it("리서치만 → 구매했어요로 돌리면 인증이 살아난다", () => {
    const bought = ready();
    expect(isVerified(bought)).toBe(true);
    const research = withPurchase(bought, "research");
    expect(research.photos[0].kind).toBe("proof");
    expect(effectivePhotoKind(research, research.photos[0])).toBe("detail");
    expect(isVerified(research)).toBe(false);
    const again = withPurchase(research, "bought");
    expect(effectivePhotoKind(again, again.photos[0])).toBe("proof");
    expect(isVerified(again)).toBe(true);
  });

  it("결과에는 지금 구매 상태만 반영된다", () => {
    const research = withPurchase(ready(), "research");
    const labels = (state: ResearchState) =>
      buildResultBody(state)!.candidates[0].summary.find((item) => item.label === "구매 인증")?.value;
    expect(labels(research)).toBe("리서치만");
    expect(labels(withPurchase(research, "bought"))).toBe("구매 인증됨");
  });

  it("리서치만에서 새로 올리는 사진은 상세페이지 캡처만 된다", () => {
    const added = addPhoto(withPurchase(ready({ photos: [] }), "research"), { kind: "proof", thumb: THUMB, description: "" });
    expect(added.photos[0].kind).toBe("detail");
  });
});

describe("F11: 기기에 저장하지 못할 썸네일은 받지 않는다", () => {
  const photo = (thumb: string): ResearchPhoto => ({ kind: "detail", thumb, description: "" });

  it("6만 글자를 넘거나 data:image/가 아니면 상태 그대로", () => {
    const state = ready({ photos: [] });
    const tooLong = `data:image/jpeg;base64,${"A".repeat(RESEARCH_LIMITS.thumbMax)}`;
    expect(addPhoto(state, photo(tooLong))).toBe(state);
    expect(addPhoto(state, photo("https://example.com/a.png"))).toBe(state);
    const exact = `data:image/jpeg;base64,${"A".repeat(RESEARCH_LIMITS.thumbMax - "data:image/jpeg;base64,".length)}`;
    expect(exact.length).toBe(RESEARCH_LIMITS.thumbMax);
    expect(addPhoto(state, photo(exact)).photos).toHaveLength(1);
  });
});

describe("F12: 고정 후보 fallback은 요청의 브랜드를 따른다", () => {
  const id = "6f1c2e4a-1111-4222-8333-444455556666";
  const names = (brand: string | null, item: string | null = "헤드셋", product = "헤드셋 사고 싶어요") => {
    const response = fallbackResponse({ requestId: id, kind: "model" }, { product, brand, item });
    return response.kind === "model" ? response.items.map((entry) => entry.name) : [];
  };

  it("다른 브랜드 요청이면 소니 기종을 후보로 내지 않는다(빈 목록)", () => {
    expect(names("LG")).toEqual([]);
  });

  it("브랜드가 맞으면 그 브랜드의 후보만, 영문 표기(Sony)도 알아본다", () => {
    expect(names("소니")).toHaveLength(3);
    expect(names("Sony")).toHaveLength(3);
    expect(names("로지텍", "키보드").every((name) => name.includes("로지텍"))).toBe(true);
  });

  it("요청의 brand가 비어도(소니 아니면 null) 문장에서 다른 브랜드를 알아보면 후보를 보이지 않는다", () => {
    expect(names(null, "헤드셋", "LG 헤드셋 사고 싶어요")).toEqual([]);
    expect(names(null, "헤드셋", "엘지 헤드셋 사고 싶어요")).toEqual([]);
    expect(names(null, "헤드셋", "Bose 헤드셋 찾아요")).toEqual([]);
    expect(names(null, "헤드셋", "삼성 헤드셋 사고 싶어요")).toEqual([]);
    expect(names(null, "키보드", "로지텍 키보드 사고 싶어요").every((name) => name.includes("로지텍"))).toBe(true);
    expect(names(null, "키보드", "로지텍 키보드 사고 싶어요")).not.toEqual([]);
  });

  it("영문 브랜드 약자는 다른 영문 낱말 안에서 걸리지 않는다", () => {
    expect(names(null, "헤드셋", "algorithm 헤드셋 사고 싶어요")).toHaveLength(3);
  });

  // R3-4: 시연 표의 브랜드(보국·일월·한일·테크·액츠·키친아트)도 요청 문장에서 알아본다
  it("시연 표의 브랜드를 문장에서 알아보면 그 후보만 낸다", () => {
    expect(names(null, "전기요", "일월 전기요 사고 싶어요")).toEqual([
      "일월 프리미엄 탄소 카본 워셔블 전기요 IW-KM59 싱글",
    ]);
    expect(names(null, "세탁세제", "테크 세탁세제 사고 싶어요")).toEqual(["테크 베이킹소다 구연산 액체세제 리필 1.8L"]);
    expect(names(null, "전기포트", "키친아트 전기포트 사고 싶어요")).toEqual(["키친아트 라팔 뉴 멀티 포트 1.7 KP-1007FT"]);
    expect(names(null, "전기요", "보국 전기요 찾아요")).toEqual(["보국전자 에어셀 전기요 BKB-0503S 싱글"]);
    expect(names(null, "전기요", "한일 전기요 찾아요")).toEqual(["한일의료기 EMF 허스트 무자계 열선 전기요 싱글 HLY-202"]);
    expect(names(null, "세탁세제", "액츠 세탁세제 찾아요")).toEqual(["액츠 퍼펙트 딥클린 액체세제 리필 1.5L"]);
  });

  it("다른 한글 낱말 안에 든 브랜드 글자는 브랜드로 보지 않는다", () => {
    expect(hasBrandWord("하이테크 세탁세제", "테크")).toBe(false);
    expect(hasBrandWord("테크 세탁세제", "테크")).toBe(true);
    expect(hasBrandWord("이 테크 세제", "테크")).toBe(true);
    expect(names(null, "세탁세제", "하이테크 세탁세제 사고 싶어요")).toHaveLength(3);
  });

  it("R4-8: 레이저가 각인·포인터·프린터·센서·마우스 앞에 오면 브랜드(Razer)로 보지 않는다", () => {
    expect(names(null, "키보드", "레이저 각인 키보드 찾아요")).toHaveLength(3);
    expect(names(null, "키보드", "레이저로 각인된 키보드 찾아요")).toHaveLength(3);
    for (const text of ["레이저 포인터", "레이저 프린터", "레이저 센서 마우스", "레이저 마우스", "레이저각인 키보드", "레이저로 각인된 키보드", "레이저로 거리 재기"]) {
      expect(hasBrandWord(text, "레이저"), text).toBe(false);
      expect(knownBrandIn(text), text).toBeNull();
    }
    // 브랜드로 쓴 레이저는 그대로 알아본다.
    expect(hasBrandWord("레이저 키보드 찾아요", "레이저")).toBe(true);
    expect(knownBrandIn("레이저 블랙위도우")).toEqual(["razer", "레이저"]);
    expect(knownBrandIn("razer 키보드")).toEqual(["razer", "레이저"]);
    // 같은 문장에 일반 낱말과 브랜드가 함께 있으면 브랜드 쪽을 알아본다.
    expect(hasBrandWord("레이저 포인터 말고 레이저 키보드", "레이저")).toBe(true);
  });

  it("고정 후보 표에 있는 모든 후보의 브랜드를 알려 둔 목록이 알아본다", () => {
    for (const item of ["헤드셋", "전기요", "세탁세제", "키보드", "전기포트"]) {
      for (const candidate of demoCandidatesFor(item)) {
        expect(knownBrandIn(candidate.name), candidate.name).not.toBeNull();
      }
    }
  });

  it("브랜드가 없으면 품목의 고정 후보를 그대로 쓴다", () => {
    expect(names(null)).toHaveLength(3);
    expect(names(null, "모르는 품목")).toEqual([]);
  });

  it("대안 후보는 브랜드를 따르면서 이미 고른 기종을 뺀다", () => {
    const response = fallbackResponse(
      { requestId: id, kind: "alts", model: "소니 WH-CH720N" },
      { product: "소니 헤드셋", brand: "소니", item: "헤드셋" },
    );
    expect(response.kind === "alts" && response.items.map((entry) => entry.name)).toEqual(["소니 WH-CH520", "소니 WH-1000XM4"]);
  });
});

describe("화면이 href에 넣는 주소는 https만 받는다", () => {
  it.each(["http://example.com/a", "javascript:alert(1)", "data:text/html,x", "//example.com/a", "example.com", "", 3, null])(
    "isHttpsUrl 거부: %s",
    (value) => {
      expect(isHttpsUrl(value)).toBe(false);
    },
  );
  it("https 주소는 받는다", () => {
    expect(isHttpsUrl("https://example.com/a?b=1#c")).toBe(true);
  });

  it("서버 응답 모양 검사가 http·javascript: 주소를 가진 응답을 거른다", () => {
    const item = (url: string | null) => ({ kind: "model", ai: "ok", items: [{ name: "a", note: "", url, origin: "web" }] });
    expect(isResearchResponse(item("https://example.com/a"))).toBe(true);
    expect(isResearchResponse(item(null))).toBe(true);
    expect(isResearchResponse(item("http://example.com/a"))).toBe(false);
    expect(isResearchResponse(item("javascript:alert(1)"))).toBe(false);
    const links = (url: string) => ({
      kind: "benefits",
      ai: "ok",
      links: [{ title: "t", url, origin: "web" }],
      shortcuts: [],
    });
    expect(isResearchResponse(links("https://example.com/a"))).toBe(true);
    expect(isResearchResponse(links("javascript:alert(1)"))).toBe(false);
    const shortcuts = (url: string) => ({ kind: "benefits", ai: "ok", links: [], shortcuts: [{ label: "x", url }] });
    expect(isResearchResponse(shortcuts("https://example.com/a"))).toBe(true);
    expect(isResearchResponse(shortcuts("data:text/html,x"))).toBe(false);
  });

  it("기기 저장값에 http·javascript: 주소가 있으면 그 링크는 읽지 않는다(체크한 링크, 저장된 도움)", () => {
    const saved = JSON.stringify({
      ...ready(),
      checked: {
        benefits: [
          { title: "ok", url: "https://example.com/a" },
          { title: "bad", url: "javascript:alert(1)" },
        ],
        refs: [{ title: "bad", url: "http://example.com/b" }],
      },
    });
    const parsed = parseStoredState(saved);
    // 한 칸이라도 모양이 틀리면 그 칸 전체를 버린다(일부만 믿지 않는다)
    expect(parsed?.checked).toEqual({ benefits: [], refs: [] });
    const withBadHelp = JSON.stringify({
      ...ready(),
      help: {
        benefits: {
          key: "k",
          response: { kind: "benefits", ai: "ok", links: [{ title: "t", url: "javascript:alert(1)", origin: "web" }], shortcuts: [] },
        },
      },
    });
    expect(parseStoredState(withBadHelp)?.help).toEqual({});
  });
});

describe("화면 문구(RESEARCH_COPY)", () => {
  const collect = (value: unknown, found: string[] = []): string[] => {
    if (typeof value === "string") found.push(value);
    else if (typeof value === "function") {
      for (const sample of [() => (value as (...args: number[]) => string)(3, 1), () => (value as (...args: unknown[]) => string)(true)]) {
        try {
          const text = sample();
          if (typeof text === "string") found.push(text);
        } catch {
          // 인자 모양이 다른 함수는 건너뛴다
        }
      }
    } else if (value && typeof value === "object") for (const inner of Object.values(value)) collect(inner, found);
    return found;
  };

  it("가격·재고·할인으로 보이는 표현이 없다", () => {
    const texts = collect(RESEARCH_COPY);
    expect(texts.length).toBeGreaterThan(80);
    for (const text of texts) expect(hasForbidden(text), text).toBe(false);
  });

  // R3-6: JSX 글자(태그 사이의 글)와 문자열 리터럴 모두 본다. 주석과 템플릿 글자 속 구분 기호(·, —)는 한글이 아니라 걸리지 않는다.
  it.each(["ResearchChat.tsx", "ResearchCards.tsx", "ResearchSummary.tsx"])(
    "%s 코드(주석 제외)에 한글 글자가 직접 적혀 있지 않다",
    (file) => {
      const source = readFileSync(path.join(process.cwd(), "src/components", file), "utf8");
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(/\r?\n/)
        .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
        .join("\n");
      const hits = code.split("\n").filter((line) => /[가-힣]/.test(line));
      expect(hits).toEqual([]);
    },
  );

  it("내려놓기 확인·목록으로·다시 시도 문구가 한 곳에 있다(다시 찾기와 다르다)", () => {
    expect(RESEARCH_COPY.buttons.release).toBe("내려놓기");
    expect(RESEARCH_COPY.buttons.releaseConfirm).toBe("내려놓기 확인");
    expect(RESEARCH_COPY.buttons.releaseCancel).toBe("취소");
    expect(RESEARCH_COPY.releasePrompt).toBe("내려놓으면 이 기기에 적은 답과 사진이 지워지고, 요청은 대기열로 돌아가요.");
    expect(RESEARCH_COPY.toList).toBe("목록으로");
    expect(RESEARCH_COPY.reload).toBe("다시 시도");
    expect(RESEARCH_COPY.reload).not.toBe(RESEARCH_COPY.retry);
  });

  it("화면에 직접 쓰던 글이 한 곳에 있다(다시 찾기, 출처 보기, 사진 설명 만드는 중 등)", () => {
    expect(RESEARCH_COPY.retry).toBe("다시 찾기");
    expect(RESEARCH_COPY.sourceLabel).toBe("출처 보기");
    expect(RESEARCH_COPY.fixedNote).toBe("시연용 고정 후보");
    expect(RESEARCH_COPY.questionKicker).toBe("AI 질문");
    expect(RESEARCH_COPY.photo.describing).toBe("사진 설명을 만드는 중이에요.");
    expect(RESEARCH_COPY.summary.stepAlt).toBe("질문 7개를 모두 지나 요약 단계예요.");
    expect(RESEARCH_COPY.alts.failed).toBe("AI가 비슷한 기종을 찾지 못했어요. 쇼핑몰에서 직접 확인해 주세요.");
  });
});
