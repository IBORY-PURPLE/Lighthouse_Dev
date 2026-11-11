import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addManualCandidate,
  CANDIDATE_STATUS_LABELS,
  candidateStatus,
  captureTargetId,
  CAPTURE_MESSAGES,
  checkProductName,
  clearDraftStore,
  draftKey,
  emptyDraftStore,
  isHttpsUrl,
  MANUAL_MESSAGES,
  MAX_MANUAL,
  moveCandidateDraft,
  nameMismatch,
  nameWarning,
  parseDraftStore,
  readCandidateDraft,
  readCandidateRecord,
  readDraftStore,
  readEdits,
  serializeDraftStore,
  setCandidateDraft,
  setCandidateEdits,
  validateManual,
  writeDraftStore,
} from "@/lib/candidateDraft";
import type { SummaryDraft } from "@/lib/summaryDraft";

const ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  return data;
}

describe("isHttpsUrl", () => {
  it("https로 시작하고 URL로 읽히며 2048자 이하일 때만 참", () => {
    expect(isHttpsUrl("https://shop.example/p/1")).toBe(true);
    expect(isHttpsUrl("http://shop.example")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("https://")).toBe(false);
    expect(isHttpsUrl("shop.example")).toBe(false);
    expect(isHttpsUrl(`https://a.example/${"x".repeat(2040)}`)).toBe(false);
    expect(isHttpsUrl(`https://a.example/${"x".repeat(2000)}`)).toBe(true);
  });
});

describe("validateManual", () => {
  it("이름과 https 링크를 다듬어 돌려준다", () => {
    expect(validateManual("  로지텍 K380 ", " https://a.example/x ")).toEqual({
      ok: true,
      name: "로지텍 K380",
      url: "https://a.example/x",
    });
  });

  it("이름이 없거나 100자를 넘으면 name 오류, http 링크는 정해진 문구의 url 오류", () => {
    expect(validateManual("  ", "https://a.example")).toEqual({
      ok: false,
      field: "name",
      message: MANUAL_MESSAGES.nameRequired,
    });
    expect(validateManual("가".repeat(101), "https://a.example")).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(validateManual("가".repeat(100), "https://a.example")).toMatchObject({ ok: true });
    expect(validateManual("이름", "http://a.example")).toEqual({
      ok: false,
      field: "url",
      message: "링크는 https://로 시작해야 합니다",
    });
  });
});

describe("기기 초안 읽기·쓰기", () => {
  it("저장한 모양을 그대로 읽는다", () => {
    const store = addManualCandidate(emptyDraftStore(), "후보 A", "https://a.example");
    store.lastOpened = "m1";
    const back = parseDraftStore(serializeDraftStore(store));
    expect(back).toEqual({
      v: 1,
      manual: [{ id: "m1", name: "후보 A", url: "https://a.example" }],
      lastOpened: "m1",
      drafts: {},
    });
  });

  it("값이 없거나 깨졌으면 빈 값이다", () => {
    for (const raw of [null, "", "{", "[]", "null", '{"v":2}', '{"v":1,"manual":"x"}']) {
      expect(parseDraftStore(raw)).toEqual(emptyDraftStore());
    }
  });

  it("후보마다 모양을 검사해서 깨진 후보만 버린다(http 링크, 이름 없음, 4번째 이후)", () => {
    const raw = JSON.stringify({
      v: 1,
      manual: [
        { id: "m1", name: "좋은 것", url: "https://a.example" },
        { id: "m2", name: "", url: "https://a.example" },
        { id: "m3", name: "나쁜 링크", url: "http://a.example" },
        { id: 4, name: "id가 숫자", url: "https://a.example" },
        { id: "m2", name: "둘째", url: "https://b.example" },
        { id: "m3", name: "셋째", url: "https://c.example" },
        { id: "m4", name: "넷째", url: "https://d.example" },
      ],
      lastOpened: 7,
      drafts: [],
    });
    const store = parseDraftStore(raw);
    expect(store.manual.map((entry) => entry.name)).toEqual(["좋은 것", "둘째", "셋째"]);
    expect(store.lastOpened).toBeNull();
    expect(store.drafts).toEqual({});
  });

  it("블록 3이 쓸 drafts는 객체면 그대로 둔다", () => {
    const store = parseDraftStore(
      JSON.stringify({ v: 1, manual: [], lastOpened: null, drafts: { c1: { draft: {}, captureCount: 2 } } }),
    );
    expect(store.drafts).toEqual({ c1: { draft: {}, captureCount: 2 } });
  });

  it("직접 추가는 비어 있는 첫 id를 쓰고 최대 3개다", () => {
    let store = emptyDraftStore();
    for (const name of ["A", "B", "C", "D"]) {
      store = addManualCandidate(store, name, "https://a.example");
    }
    expect(store.manual.map((entry) => entry.id)).toEqual(["m1", "m2", "m3"]);
    expect(store.manual).toHaveLength(MAX_MANUAL);
  });

  it("localStorage에 요청별 키로 쓰고, 읽고, 지운다", () => {
    const data = stubStorage();
    expect(draftKey(ID)).toBe(`lh.vol.draft.v1.${ID}`);
    expect(readDraftStore(ID)).toEqual(emptyDraftStore());
    writeDraftStore(ID, addManualCandidate(emptyDraftStore(), "A", "https://a.example"));
    expect(data.has(draftKey(ID))).toBe(true);
    expect(readDraftStore(ID).manual).toHaveLength(1);
    clearDraftStore(ID);
    expect(data.size).toBe(0);
  });

  it("저장소 접근이 막혀도 던지지 않는다", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
    });
    expect(readDraftStore(ID)).toEqual(emptyDraftStore());
    expect(() => writeDraftStore(ID, emptyDraftStore())).not.toThrow();
    expect(() => clearDraftStore(ID)).not.toThrow();
  });
});

/** 항목 5개가 다 있는 초안. productName만 바꿔 쓴다(null이면 못 읽은 것). */
function sampleDraft(productName: string | null): SummaryDraft {
  const field = (key: SummaryDraft["fields"][number]["key"], label: string, value: string | null) => ({
    key,
    label,
    value,
    evidence: value,
    check: value ? ("matched" as const) : ("missing" as const),
    needsCheck: false,
    reason: null,
  });
  return {
    draftVersion: 1,
    source: "ocr",
    fields: [
      field("productName", "상품명", productName),
      field("option", "옵션", "블랙"),
      field("spec", "핵심 사양", null),
      field("components", "구성품", null),
      field("caution", "주의사항", null),
    ],
    missing: ["spec", "components", "caution"],
    unreadable: [],
  };
}

describe("후보별 요약 초안(블록 3)", () => {
  it("후보 상태: 초안이 없으면 캡처 필요, 있으면 읽음, 확인했으면 확인함", () => {
    let store = emptyDraftStore();
    expect(candidateStatus(store, "c1")).toBe("needs_capture");
    store = setCandidateDraft(store, "c1", sampleDraft("소니 WH-CH720N"), 3);
    expect(candidateStatus(store, "c1")).toBe("read");
    expect(candidateStatus(store, "c2")).toBe("needs_capture");
    const confirmed = {
      ...store,
      drafts: { c1: { ...store.drafts.c1, confirmed: true } },
    };
    expect(candidateStatus(confirmed, "c1")).toBe("confirmed");
    expect(CANDIDATE_STATUS_LABELS).toEqual({
      needs_capture: "캡처 필요",
      read: "캡처 읽음 · 확인 전",
      confirmed: "요약 확인함",
    });
  });

  it("초안 모양이 아닌 칸은 캡처 필요로 본다", () => {
    const store = parseDraftStore(
      JSON.stringify({ v: 1, manual: [], lastOpened: null, drafts: { c1: { draft: {}, captureCount: 2 } } }),
    );
    expect(readCandidateDraft(store, "c1")).toBeNull();
    expect(candidateStatus(store, "c1")).toBe("needs_capture");
  });

  it("초안 칸은 draft·captureCount·confirmed를 쓰고 직렬화해도 그대로 읽힌다", () => {
    const draft = sampleDraft("소니 WH-CH720N");
    const store = setCandidateDraft(emptyDraftStore(), "c2", draft, 2);
    expect(store.drafts.c2).toEqual({ draft, captureCount: 2, confirmed: false });
    const again = parseDraftStore(serializeDraftStore(store));
    expect(readCandidateDraft(again, "c2")).toEqual({ draft, captureCount: 2, confirmed: false });
  });

  it("초안을 쓰면 마지막으로 연 후보와 직접 추가 후보는 그대로다", () => {
    let store = addManualCandidate(emptyDraftStore(), "A", "https://a.example");
    store = { ...store, lastOpened: "m1" };
    const next = setCandidateDraft(store, "m1", sampleDraft("A"), 1);
    expect(next.lastOpened).toBe("m1");
    expect(next.manual).toEqual(store.manual);
  });

  it("다른 후보로 옮기면 보내는 쪽은 캡처 필요로 돌아가고, 같은 후보나 빈 칸이면 그대로다", () => {
    const store = setCandidateDraft(emptyDraftStore(), "c2", sampleDraft("x"), 2);
    const moved = moveCandidateDraft(store, "c2", "c3");
    expect(candidateStatus(moved, "c2")).toBe("needs_capture");
    expect(candidateStatus(moved, "c3")).toBe("read");
    expect(readCandidateDraft(moved, "c3")?.captureCount).toBe(2);
    expect(moveCandidateDraft(store, "c2", "c2")).toBe(store);
    expect(moveCandidateDraft(store, "c1", "c3")).toBe(store);
  });

  it("저장할 후보: 마지막으로 연 후보, 없으면 첫 캡처 필요, 그것도 없으면 첫 후보, 후보가 없으면 null", () => {
    const ids = ["c1", "c2", "c3"];
    const empty = emptyDraftStore();
    expect(captureTargetId(empty, [])).toBeNull();
    expect(captureTargetId(empty, ids)).toBe("c1");
    expect(captureTargetId({ ...empty, lastOpened: "c2" }, ids)).toBe("c2");
    // 목록에 없는 후보를 가리키면 건너뛴다.
    expect(captureTargetId({ ...empty, lastOpened: "m9" }, ids)).toBe("c1");
    const withFirst = setCandidateDraft(empty, "c1", sampleDraft("x"), 1);
    expect(captureTargetId(withFirst, ids)).toBe("c2");
    let all = withFirst;
    for (const id of ["c2", "c3"]) all = setCandidateDraft(all, id, sampleDraft("x"), 1);
    expect(captureTargetId(all, ids)).toBe("c1");
  });
});

describe("nameMismatch: 읽은 상품명이 후보와 다른가", () => {
  const cases: Array<[string, string, string, boolean]> = [
    ["같은 이름", "소니 WH-CH720N", "소니 WH-CH720N", false],
    ["공백·기호·대소문자는 무시", "WH CH720N", "소니 wh-ch720n", false],
    ["후보가 읽은 이름을 품는다", "WH-CH720N", "소니 WH-CH720N 무선 헤드폰", false],
    ["읽은 이름이 후보를 품는다", "소니 WH-CH720N 무선 노이즈캔슬링 헤드폰 블랙", "소니 WH-CH720N", false],
    ["모델 글자가 겹친다", "SONY WH-CH720N 블랙", "소니 WH-CH720N 헤드폰", false],
    ["모델이 다르다", "소니 WH-CH520", "소니 WH-CH720N", true],
    ["전혀 다른 상품", "가짜 헤드셋 LH-200", "소니 WH-CH520", true],
    ["영문 이름만 있어도 비교한다", "Bose QuietComfort 45", "소니 WH-1000XM4", true],
    ["모델 글자는 영문+숫자를 모두 가져야 한다(숫자만으로는 겹침이 아니다)", "무선 헤드폰 2023", "무선 이어폰 2023 플러스", true],
  ];
  for (const [name, read, candidate, expected] of cases) {
    it(`${name}: ${expected ? "다름" : "같음"}`, () => {
      expect(nameMismatch(read, candidate)).toBe(expected);
    });
  }

  it("어느 쪽이 비어 있으면 비교하지 않는다", () => {
    expect(nameMismatch("", "소니 WH-CH720N")).toBe(false);
    expect(nameMismatch("  ", "소니 WH-CH720N")).toBe(false);
    expect(nameMismatch("소니", "")).toBe(false);
  });
});

describe("상품명 확인과 경고 글자", () => {
  it("읽지 못했으면 어느 후보인지 묻는다", () => {
    const check = checkProductName(sampleDraft(null), "소니 WH-CH520");
    expect(check).toEqual({ kind: "missing" });
    expect(nameWarning(check, "소니 WH-CH520")).toBe(
      "상품명을 읽지 못했습니다. 어느 후보의 캡처인지 골라 주세요.",
    );
  });

  it("다르면 읽은 이름과 후보 이름을 넣어 알린다", () => {
    const check = checkProductName(sampleDraft("가짜 헤드셋 LH-200"), "소니 WH-CH520");
    expect(check).toEqual({ kind: "mismatch", readName: "가짜 헤드셋 LH-200" });
    expect(nameWarning(check, "소니 WH-CH520")).toBe(
      "읽은 상품명 ‘가짜 헤드셋 LH-200’이 후보 ‘소니 WH-CH520’와 다릅니다. 맞는 후보로 바꾸세요.",
    );
  });

  it("같으면 경고가 없다", () => {
    const check = checkProductName(sampleDraft("소니 WH-CH520"), "소니 WH-CH520");
    expect(check).toEqual({ kind: "ok" });
    expect(nameWarning(check, "소니 WH-CH520")).toBeNull();
  });

  it("저장 알림 문구", () => {
    expect(CAPTURE_MESSAGES.saved(3, 2)).toBe("캡처 3장을 후보 2에 저장했습니다");
    expect(CAPTURE_MESSAGES.savedHint).toBe(
      "마지막으로 ‘쇼핑몰에서 보기’를 누른 후보입니다. 읽은 상품명이 후보와 다르면 알려 드립니다.",
    );
    expect(CAPTURE_MESSAGES.noCandidates).toBe("후보를 먼저 추가해 주세요");
  });
});

describe("후보 확인·고침(블록 4)", () => {
  const draftOf = (name: string) => sampleDraft(name);

  it("캡처가 없는 후보도 확인하면 확인함이 되고, 고치면 다시 캡처 필요(확인 전)로 돌아간다", () => {
    let store = setCandidateEdits(emptyDraftStore(), "c2", { name: "N", url: "https://a.example", guide: "" }, true);
    expect(candidateStatus(store, "c2")).toBe("confirmed");
    expect(readCandidateRecord(store, "c2")).toMatchObject({ draft: null, captureCount: 0, confirmed: true });
    // 초안이 없는 칸은 readCandidateDraft에는 잡히지 않는다.
    expect(readCandidateDraft(store, "c2")).toBeNull();
    store = setCandidateEdits(store, "c2", { name: "N2", url: "https://a.example", guide: "" }, false);
    expect(candidateStatus(store, "c2")).toBe("needs_capture");
  });

  it("초안이 있는 후보: 확인하면 확인함, 고치면(confirmed false) 읽음(확인 전)으로 돌아가고 초안은 그대로다", () => {
    const draft = draftOf("소니 WH-CH720N");
    let store = setCandidateDraft(emptyDraftStore(), "c1", draft, 3);
    store = setCandidateEdits(store, "c1", { guide: "가이드" }, true);
    expect(candidateStatus(store, "c1")).toBe("confirmed");
    store = setCandidateEdits(store, "c1", { guide: "가이드 2" }, false);
    expect(candidateStatus(store, "c1")).toBe("read");
    expect(readCandidateDraft(store, "c1")).toEqual({
      draft,
      captureCount: 3,
      edits: { guide: "가이드 2" },
      confirmed: false,
    });
  });

  it("새 캡처를 저장하면 확인 표시와 항목 값은 지워지고 상품명·링크·가이드 고침은 남는다", () => {
    let store = setCandidateEdits(
      emptyDraftStore(),
      "c1",
      { name: "N", url: "https://a.example", guide: "G", values: { option: "블랙" } },
      true,
    );
    store = setCandidateDraft(store, "c1", draftOf("x"), 1);
    expect(candidateStatus(store, "c1")).toBe("read");
    expect(readCandidateDraft(store, "c1")?.edits).toEqual({ name: "N", url: "https://a.example", guide: "G" });
  });

  it("다른 후보로 옮기면 상품명·링크 고침과 확인 표시는 따라가지 않는다", () => {
    let store = setCandidateDraft(emptyDraftStore(), "c2", draftOf("x"), 2);
    store = setCandidateEdits(store, "c2", { name: "c2 이름", url: "https://c2.example" }, true);
    const moved = moveCandidateDraft(store, "c2", "c3");
    expect(candidateStatus(moved, "c2")).toBe("needs_capture");
    expect(candidateStatus(moved, "c3")).toBe("read");
    expect(readCandidateDraft(moved, "c3")?.edits).toBeUndefined();
  });

  it("edits는 모양대로만 읽는다: 글자가 아닌 값과 모르는 속성은 버린다", () => {
    expect(readEdits(null)).toBeNull();
    expect(readEdits([])).toBeNull();
    expect(readEdits({ name: 1, other: "x" })).toBeNull();
    expect(readEdits({ name: "N", values: { option: "블랙", spec: 3 } })).toEqual({
      name: "N",
      values: { option: "블랙" },
    });
  });

  it("직렬화해도 확인·고침이 그대로 읽힌다", () => {
    const store = setCandidateEdits(emptyDraftStore(), "m1", { name: "A", url: "https://a.example", guide: "g" }, true);
    const again = parseDraftStore(serializeDraftStore(store));
    expect(candidateStatus(again, "m1")).toBe("confirmed");
    expect(readCandidateRecord(again, "m1")?.edits).toEqual({ name: "A", url: "https://a.example", guide: "g" });
  });
});
