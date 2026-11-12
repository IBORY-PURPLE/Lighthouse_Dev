import { describe, expect, it } from "vitest";
import {
  addAlt,
  addPhoto,
  allowedPhotoKinds,
  benefitShortcuts,
  buildPhotoRequest,
  buildResearchRequest,
  cachedHelp,
  canGoNext,
  canGoPrev,
  canSend,
  canSkip,
  cardHelper,
  clampStep,
  defaultQuestion,
  draftSummaryText,
  emptyResearchState,
  goNext,
  goPrev,
  goToCard,
  isCardAnswered,
  isResearchResponse,
  isVerified,
  missingRequiredCards,
  nextLabel,
  parseStoredState,
  proofMissingNotice,
  purchaseBadge,
  refShortcuts,
  removeAlt,
  removePhoto,
  RESEARCH_CARDS,
  RESEARCH_LIMITS,
  researchStorageKey,
  setPhotoDescription,
  siteNameOf,
  SUMMARY_STEP,
  toggleChecked,
  withEulReul,
  withHelp,
  withPurchase,
  type ResearchPhoto,
  type ResearchResponse,
  type ResearchState,
} from "@/lib/research";

const THUMB = "data:image/jpeg;base64,AAAA";
const photo = (kind: ResearchPhoto["kind"]): ResearchPhoto => ({ kind, thumb: THUMB, description: "" });

/** 필수 카드를 모두 채운 상태. */
function complete(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    ...emptyResearchState(),
    purchase: "bought",
    model: "소니 WH-CH720N",
    pros: "가벼워요",
    photos: [photo("proof")],
    alts: ["소니 WH-CH520"],
    altReason: "가격 대신 무게를 봤어요",
    ...overrides,
  };
}

describe("카드 상수", () => {
  it("순서는 model, pros, photo, alts, altReason, benefits, refs이고 앞 5장이 필수다", () => {
    expect(RESEARCH_CARDS.map((card) => card.id)).toEqual([
      "model",
      "pros",
      "photo",
      "alts",
      "altReason",
      "benefits",
      "refs",
    ]);
    expect(RESEARCH_CARDS.map((card) => card.required)).toEqual([true, true, true, true, true, false, false]);
    expect(RESEARCH_CARDS.map((card) => card.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(SUMMARY_STEP).toBe(7);
  });

  it("기본 질문과 보조 문구는 설계 지침 문구 그대로다", () => {
    const ctx = { subject: "소니 헤드셋", model: "소니 WH-CH720N", alts: ["소니 WH-CH520", "소니 WH-1000XM4"] };
    expect(defaultQuestion("model", ctx)).toBe("소니 헤드셋 기종을 찾아 주세요.");
    expect(defaultQuestion("pros", ctx)).toBe("소니 WH-CH720N의 장점이 뭐예요?");
    expect(defaultQuestion("photo", ctx)).toBe("제품 사진을 올려 주세요.");
    expect(defaultQuestion("alts", ctx)).toBe("소니 WH-CH720N을(를) 살 때 같이 고민한 다른 제품이 있나요?");
    expect(defaultQuestion("altReason", ctx)).toBe(
      "소니 WH-CH520, 소니 WH-1000XM4을(를) 왜 같이 고민했나요?",
    );
    expect(defaultQuestion("benefits", ctx)).toBe("살 때 받은 혜택이 있나요?");
    expect(defaultQuestion("refs", ctx)).toBe("참고한 유튜브나 블로그 글이 있나요?");
    expect(cardHelper("model")).toBe("직접 사 본 기종이 있으면 그 기종을 알려 주세요.");
    expect(cardHelper("photo")).toBe("상품 상세페이지 이미지나 직접 찍은 착샷이면 됩니다. 1~3장.");
    expect(cardHelper("benefits")).toBe("지금 살 때 받을 수 있는 혜택도 같이 확인해요.");
    expect(cardHelper("pros")).toBeNull();
  });

  it("기종이 비었을 때도 질문이 깨지지 않는다", () => {
    const ctx = { subject: "", model: "", alts: [] };
    expect(defaultQuestion("model", ctx)).toBe("제품 기종을 찾아 주세요.");
    expect(defaultQuestion("pros", ctx)).toBe("이 제품의 장점이 뭐예요?");
  });

  it("조사: 한글은 받침으로 을/를을 고르고 영문·숫자 끝은 을(를)로 쓴다", () => {
    expect(withEulReul("헤드셋")).toBe("헤드셋을");
    expect(withEulReul("키보드")).toBe("키보드를");
    expect(withEulReul("WH-CH720N")).toBe("WH-CH720N을(를)");
  });
});

describe("카드 판단", () => {
  it("처음에는 필수 카드 5장이 모두 빠져 있고 보낼 수 없다", () => {
    const state = emptyResearchState();
    expect(missingRequiredCards(state).map((card) => card.id)).toEqual([
      "model",
      "pros",
      "photo",
      "alts",
      "altReason",
    ]);
    expect(canSend(state)).toBe(false);
  });

  it("기종 카드는 이름과 구매 여부 선택이 둘 다 있어야 답한 것이다", () => {
    expect(isCardAnswered({ ...emptyResearchState(), model: "WH-CH720N" }, "model")).toBe(false);
    expect(isCardAnswered({ ...emptyResearchState(), purchase: "research" }, "model")).toBe(false);
    expect(isCardAnswered({ ...emptyResearchState(), model: " WH ", purchase: "research" }, "model")).toBe(true);
  });

  it("필수 카드를 채우면 보낼 수 있고, 선택 카드는 비어 있어도 된다", () => {
    expect(canSend(complete())).toBe(true);
    expect(isCardAnswered(complete(), "benefits")).toBe(false);
    expect(isCardAnswered(complete({ benefits: "무료 배송" }), "benefits")).toBe(true);
    expect(
      isCardAnswered(complete({ checked: { benefits: [], refs: [{ title: "글", url: "https://a.example/x" }] } }), "refs"),
    ).toBe(true);
  });

  it("공백만 있는 답은 답이 아니다", () => {
    expect(isCardAnswered(complete({ pros: "   " }), "pros")).toBe(false);
    expect(missingRequiredCards(complete({ altReason: " " })).map((card) => card.id)).toEqual(["altReason"]);
  });

  it("다음/이전/건너뛰기 판단", () => {
    const first = emptyResearchState();
    expect(canGoPrev(first)).toBe(false);
    expect(canGoNext(first)).toBe(false);
    expect(goNext(first).step).toBe(0);
    const answered = { ...first, model: "WH", purchase: "bought" as const };
    expect(goNext(answered).step).toBe(1);
    expect(canGoPrev(goNext(answered))).toBe(true);
    expect(goPrev(goNext(answered)).step).toBe(0);

    const optional = goToCard(complete(), "benefits");
    expect(optional.step).toBe(5);
    expect(canSkip(optional)).toBe(true);
    expect(canGoNext(optional)).toBe(true);
    expect(canSkip(goToCard(complete(), "pros"))).toBe(false);

    const last = goToCard(complete(), "refs");
    expect(nextLabel(last)).toBe("요약 보기");
    expect(nextLabel(optional)).toBe("다음");
    expect(goNext(last).step).toBe(SUMMARY_STEP);
    expect(canGoNext(goNext(last))).toBe(false);
    expect(goPrev(goNext(last)).step).toBe(6);
  });

  it("step은 0~7로 맞춘다", () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(99)).toBe(7);
    expect(clampStep(2.9)).toBe(2);
    expect(clampStep(Number.NaN)).toBe(0);
  });
});

describe("구매 인증", () => {
  it("verified는 구매했고 착샷이 1장 이상일 때만 참이다", () => {
    expect(isVerified(complete())).toBe(true);
    expect(isVerified(complete({ photos: [photo("detail")] }))).toBe(false);
    expect(isVerified(complete({ purchase: "research", photos: [photo("proof")] }))).toBe(false);
    expect(isVerified(emptyResearchState())).toBe(false);
  });

  it("배지 문구", () => {
    expect(purchaseBadge(emptyResearchState())).toEqual({ kind: "before", label: "구매 인증 전", note: null });
    expect(purchaseBadge(complete({ photos: [photo("detail")] }))).toEqual({
      kind: "before",
      label: "구매 인증 전",
      note: "착샷을 올리면 인증돼요",
    });
    expect(purchaseBadge(complete())).toEqual({ kind: "verified", label: "구매 인증됨 · 봉사시간 가산", note: null });
    expect(purchaseBadge(complete({ purchase: "research" }))).toEqual({
      kind: "research",
      label: "리서치만",
      note: null,
    });
  });

  it("구매했지만 착샷이 없으면 요약 화면에서 알린다", () => {
    expect(proofMissingNotice(complete({ photos: [photo("detail")] }))).toContain("리서치만");
    expect(proofMissingNotice(complete())).toBeNull();
    expect(proofMissingNotice(complete({ purchase: "research" }))).toBeNull();
  });

  it("구매하지 않았으면 상세페이지 캡처만 올릴 수 있다", () => {
    expect(allowedPhotoKinds("bought")).toEqual(["proof", "detail"]);
    expect(allowedPhotoKinds("research")).toEqual(["detail"]);
    expect(allowedPhotoKinds("unset")).toEqual(["detail"]);
    const added = addPhoto({ ...emptyResearchState(), purchase: "research" }, photo("proof"));
    expect(added.photos[0].kind).toBe("detail");
  });

  it("구매 여부를 리서치만으로 바꾸면 착샷은 상세 캡처로 바뀐다", () => {
    const changed = withPurchase(complete(), "research");
    expect(changed.photos.map((entry) => entry.kind)).toEqual(["detail"]);
    expect(isVerified(changed)).toBe(false);
    expect(withPurchase(changed, "bought").photos.map((entry) => entry.kind)).toEqual(["detail"]);
  });
});

describe("상태 바꾸기", () => {
  it("대안은 최대 2개, 중복·빈 값·기종과 같은 이름은 넣지 않는다", () => {
    let state = complete({ alts: [] });
    state = addAlt(state, "  A 제품 ");
    state = addAlt(state, "a 제품");
    state = addAlt(state, "");
    state = addAlt(state, "소니 wh-ch720n");
    expect(state.alts).toEqual(["A 제품"]);
    state = addAlt(state, "B 제품");
    state = addAlt(state, "C 제품");
    expect(state.alts).toEqual(["A 제품", "B 제품"]);
    expect(removeAlt(state, "A 제품").alts).toEqual(["B 제품"]);
  });

  it("사진은 최대 3장이고 설명은 200자까지다", () => {
    let state = complete({ photos: [] });
    for (let i = 0; i < 5; i += 1) state = addPhoto(state, photo("proof"));
    expect(state.photos).toHaveLength(RESEARCH_LIMITS.maxPhotos);
    state = setPhotoDescription(state, 1, "가".repeat(300));
    expect([...state.photos[1].description]).toHaveLength(200);
    expect(removePhoto(state, 0).photos).toHaveLength(2);
  });

  it("링크 체크는 같은 주소를 한 번만 담고 다시 누르면 푼다", () => {
    const link = { title: "글", url: "https://a.example/x" };
    let state = complete();
    state = toggleChecked(state, "refs", link);
    state = toggleChecked(state, "refs", { ...link, title: "다른 제목" });
    expect(state.checked.refs).toEqual([]);
    state = toggleChecked(state, "refs", link);
    expect(state.checked.refs).toEqual([link]);
    expect(state.checked.benefits).toEqual([]);
  });
});

describe("AI 도움 캐시", () => {
  const response: ResearchResponse = { kind: "pros", ai: "ok", question: "q", hints: ["h"] };

  it("같은 입력이면 캐시를 쓰고, 기종이 바뀌면 쓰지 않는다", () => {
    const state = withHelp(complete(), "pros", response);
    expect(cachedHelp(state, "pros")).toEqual(response);
    expect(cachedHelp({ ...state, model: "다른 기종" }, "pros")).toBeNull();
    expect(cachedHelp(state, "alts")).toBeNull();
  });

  it("대안 이유의 캐시는 대안이 바뀌면 무효다", () => {
    const reply: ResearchResponse = { kind: "altReason", ai: "ok", question: "q", hints: [] };
    const state = withHelp(complete(), "altReason", reply);
    expect(cachedHelp(state, "altReason")).toEqual(reply);
    expect(cachedHelp({ ...state, alts: ["다른 제품"] }, "altReason")).toBeNull();
  });

  it("기종 후보 캐시는 입력이 없으므로 항상 유효하다", () => {
    const reply: ResearchResponse = { kind: "model", ai: "fallback", items: [] };
    expect(cachedHelp(withHelp(complete(), "model", reply), "model")).toEqual(reply);
  });
});

describe("요청 본문 만들기", () => {
  const id = "6f1c2e4a-1111-4222-8333-444455556666";

  it("kind별로 필요한 값만 담는다", () => {
    const state = complete({ model: "  소니 WH-CH720N " });
    expect(buildResearchRequest(id, "model", state)).toEqual({ requestId: id, kind: "model" });
    expect(buildResearchRequest(id, "pros", state)).toEqual({ requestId: id, kind: "pros", model: "소니 WH-CH720N" });
    expect(buildResearchRequest(id, "altReason", state)).toEqual({
      requestId: id,
      kind: "altReason",
      model: "소니 WH-CH720N",
      alts: ["소니 WH-CH520"],
    });
    expect(buildResearchRequest(id, "summary", state)).toMatchObject({
      kind: "summary",
      model: "소니 WH-CH720N",
      pros: "가벼워요",
      altReason: "가격 대신 무게를 봤어요",
    });
    expect(buildPhotoRequest(id, state, "data:image/png;base64,AA==", "proof")).toEqual({
      requestId: id,
      kind: "photo",
      model: "소니 WH-CH720N",
      photoKind: "proof",
      image: "data:image/png;base64,AA==",
    });
  });
});

describe("바로가기·링크", () => {
  it("혜택 바로가기는 쿠팡·11번가·G마켓 검색 주소이고 검색어가 인코딩된다", () => {
    const shortcuts = benefitShortcuts("소니 WH-CH720N");
    expect(shortcuts.map((entry) => entry.label)).toEqual(["쿠팡에서 찾기", "11번가에서 찾기", "G마켓에서 찾기"]);
    for (const entry of shortcuts) {
      expect(entry.url.startsWith("https://")).toBe(true);
      expect(entry.url).toContain(encodeURIComponent("소니 WH-CH720N"));
    }
  });

  it("참고 글 바로가기는 네이버 블로그와 유튜브 검색 주소다", () => {
    const shortcuts = refShortcuts("소니 WH-CH720N");
    expect(shortcuts.map((entry) => entry.label)).toEqual(["네이버 블로그에서 찾기", "유튜브에서 찾기"]);
    expect(shortcuts[0].url).toContain("search.naver.com");
    expect(shortcuts[1].url).toContain("youtube.com/results");
    for (const entry of shortcuts) expect(entry.url).toContain(encodeURIComponent("소니 WH-CH720N 후기"));
  });

  it("사이트 이름은 도메인에서 www.를 뺀 것이다", () => {
    expect(siteNameOf("https://www.example.com/a?b=1")).toBe("example.com");
    expect(siteNameOf("not a url")).toBe("");
  });
});

describe("핵심 정리 기본 글", () => {
  it("답을 이어 만들고 빈 답은 건너뛴다", () => {
    const text = draftSummaryText(complete({ benefits: "", refs: "블로그 후기를 봤어요" }));
    expect(text.split("\n")).toEqual([
      "추천 기종: 소니 WH-CH720N",
      "장점: 가벼워요",
      "같이 고민한 제품: 소니 WH-CH520",
      "고민한 이유: 가격 대신 무게를 봤어요",
      "참고: 블로그 후기를 봤어요",
    ]);
  });

  it("최대 길이를 넘기지 않는다", () => {
    const text = draftSummaryText(complete({ pros: "가".repeat(900) }), 600);
    expect([...text]).toHaveLength(600);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("서버 응답 검사와 저장 상태 읽기", () => {
  it("isResearchResponse는 kind별 모양을 확인한다", () => {
    expect(isResearchResponse({ kind: "model", ai: "ok", items: [{ name: "a", note: "", url: null, origin: "fixed" }] })).toBe(true);
    expect(isResearchResponse({ kind: "model", ai: "ok", items: [{ name: "a" }] })).toBe(false);
    expect(isResearchResponse({ kind: "pros", ai: "fallback", question: "q", hints: [] })).toBe(true);
    expect(isResearchResponse({ kind: "pros", ai: "later", question: "q", hints: [] })).toBe(false);
    expect(isResearchResponse({ kind: "refs", ai: "ok", digest: [], links: [], shortcuts: [] })).toBe(true);
    expect(isResearchResponse({ kind: "photo", ai: "ok", description: 3 })).toBe(false);
    expect(isResearchResponse({ kind: "summary", ai: "ok", text: "t" })).toBe(true);
    expect(isResearchResponse({ kind: "other", ai: "ok" })).toBe(false);
    expect(isResearchResponse(null)).toBe(false);
  });

  it("저장했다 읽으면 같은 상태가 돌아온다", () => {
    const state = withHelp(
      complete({
        step: 4,
        summaryText: "정리",
        checked: { benefits: [{ title: "혜택", url: "https://a.example/b" }], refs: [] },
      }),
      "pros",
      { kind: "pros", ai: "ok", question: "q", hints: ["h"] },
    );
    expect(parseStoredState(JSON.stringify(state))).toEqual(state);
  });

  it("깨진 저장값은 null이거나 허용 범위로 고쳐 읽는다", () => {
    expect(parseStoredState(null)).toBeNull();
    expect(parseStoredState("not json")).toBeNull();
    expect(parseStoredState(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseStoredState(JSON.stringify([1]))).toBeNull();

    const messy = parseStoredState(
      JSON.stringify({
        v: 1,
        step: 40,
        purchase: "weird",
        model: 3,
        alts: ["a", "b", "c", 4],
        photos: [{ kind: "proof", thumb: "http://evil/x", description: "x" }, { kind: "proof", thumb: THUMB, description: "ok" }],
        help: { pros: { key: "k", response: { kind: "model", ai: "ok", items: [] } } },
      }),
    );
    expect(messy).not.toBeNull();
    expect(messy?.step).toBe(7);
    expect(messy?.purchase).toBe("unset");
    expect(messy?.model).toBe("");
    expect(messy?.alts).toEqual([]);
    // 구매 여부가 정해지지 않았으므로 착샷은 상세 캡처로 읽힌다. 모양이 틀린 사진·도움은 버린다.
    expect(messy?.photos).toEqual([{ kind: "detail", thumb: THUMB, description: "ok" }]);
    expect(messy?.help).toEqual({});
  });

  it("저장 키는 요청 id별이다", () => {
    expect(researchStorageKey("abc")).toBe("lh.vol.research.v1.abc");
  });
});
