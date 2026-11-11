import { describe, expect, it } from "vitest";
import {
  emptyDraftStore,
  readCandidateRecord,
  setCandidateDraft,
  setCandidateEdits,
} from "@/lib/candidateDraft";
import { buildForm, checkForm, EDITABLE_KEYS, formEdits, SUMMARY_MESSAGES } from "@/lib/summaryEdit";
import type { SummaryDraft } from "@/lib/summaryDraft";

const CANDIDATE = { name: "소니 WH-CH720N", url: "https://search.11st.co.kr/pc/total-search?kwd=a" };

function draft(): SummaryDraft {
  const field = (
    key: SummaryDraft["fields"][number]["key"],
    label: string,
    value: string | null,
    check: "matched" | "unverified" | "missing",
    needsCheck = false,
  ) => ({ key, label, value, evidence: value ? `근거: ${value}` : null, check, needsCheck, reason: null });
  return {
    draftVersion: 1,
    source: "ocr",
    fields: [
      field("productName", "상품명", "소니 WH-CH720N", "matched"),
      field("option", "옵션", "블랙, 화이트", "matched"),
      field("spec", "핵심 사양", "최대 40시간", "unverified", true),
      field("components", "구성품", null, "missing"),
      field("caution", "주의사항", "물에 닿지 않게", "matched", true),
    ],
    missing: ["components"],
    unreadable: [],
  };
}

describe("요약 확인 입력 칸(summaryEdit)", () => {
  it("상세 요약은 상품명을 뺀 네 항목이다", () => {
    expect(EDITABLE_KEYS).toEqual(["option", "spec", "components", "caution"]);
  });

  it("초안이 있으면: matched는 값을 채우고, unverified·missing은 비우고 확인 필요, needsCheck도 칩이 붙는다", () => {
    const record = readCandidateRecord(setCandidateDraft(emptyDraftStore(), "c1", draft(), 2), "c1");
    const form = buildForm(CANDIDATE, record);
    expect(form).toMatchObject({ name: CANDIDATE.name, url: CANDIDATE.url, guide: "", hasDraft: true });
    const byKey = Object.fromEntries(form.items.map((item) => [item.key, item]));
    expect(byKey.option).toMatchObject({ value: "블랙, 화이트", needsCheck: false, evidence: "근거: 블랙, 화이트" });
    expect(byKey.spec).toMatchObject({ value: "", needsCheck: true, evidence: "근거: 최대 40시간" });
    expect(byKey.components).toMatchObject({ value: "", needsCheck: true, evidence: null });
    expect(byKey.caution).toMatchObject({ value: "물에 닿지 않게", needsCheck: true });
  });

  it("값을 고치면 그 항목의 확인 필요 칩이 사라진다. 고친 값이 기본값을 이긴다(빈 값으로 지운 것 포함)", () => {
    let store = setCandidateDraft(emptyDraftStore(), "c1", draft(), 1);
    const form = buildForm(CANDIDATE, readCandidateRecord(store, "c1"));
    const edited = {
      ...form,
      guide: "구매하기를 누릅니다",
      items: form.items.map((item) =>
        item.key === "spec" ? { ...item, value: "40시간" } : item.key === "option" ? { ...item, value: "" } : item,
      ),
    };
    store = setCandidateEdits(store, "c1", formEdits(edited), false);
    const again = buildForm(CANDIDATE, readCandidateRecord(store, "c1"));
    const byKey = Object.fromEntries(again.items.map((item) => [item.key, item]));
    expect(byKey.spec).toMatchObject({ value: "40시간", needsCheck: false });
    expect(byKey.option).toMatchObject({ value: "", needsCheck: false });
    expect(byKey.components.needsCheck).toBe(true);
    expect(again.guide).toBe("구매하기를 누릅니다");
  });

  it("캡처가 없는 후보도 만들어진다: 네 항목이 모두 비어 있고 확인 필요", () => {
    const form = buildForm(CANDIDATE, null);
    expect(form.hasDraft).toBe(false);
    expect(form.items).toHaveLength(4);
    expect(form.items.every((item) => item.value === "" && item.needsCheck && item.evidence === null)).toBe(true);
  });

  it("값이 200자를 넘는 초안은 200자까지만 채운다", () => {
    const long = draft();
    long.fields[1] = { ...long.fields[1], value: "가".repeat(300) };
    const form = buildForm(CANDIDATE, readCandidateRecord(setCandidateDraft(emptyDraftStore(), "c1", long, 1), "c1"));
    expect([...form.items[0].value]).toHaveLength(200);
    expect(checkForm(form).ok).toBe(true);
  });

  it("보낼 모양: 빈 값 항목은 빼고, 링크·이름·가이드를 담는다", () => {
    const form = buildForm(CANDIDATE, readCandidateRecord(setCandidateDraft(emptyDraftStore(), "c1", draft(), 1), "c1"));
    const checked = checkForm({ ...form, guide: " 가이드 " });
    expect(checked).toEqual({
      ok: true,
      candidate: {
        name: CANDIDATE.name,
        url: CANDIDATE.url,
        guide: "가이드",
        summary: [
          { label: "옵션", value: "블랙, 화이트" },
          { label: "주의사항", value: "물에 닿지 않게" },
        ],
      },
    });
  });

  it("검사: 빈 이름, http 링크, 너무 긴 링크·가이드·값은 칸과 이유를 돌려준다", () => {
    const form = buildForm(CANDIDATE, null);
    expect(checkForm({ ...form, name: " " })).toMatchObject({ ok: false, field: "name" });
    expect(checkForm({ ...form, url: "http://a.example" })).toEqual({
      ok: false,
      field: "url",
      message: "링크는 https://로 시작해야 합니다",
    });
    expect(checkForm({ ...form, url: "https://a.example/" + "a".repeat(2050) })).toMatchObject({
      ok: false,
      field: "url",
      message: SUMMARY_MESSAGES.urlTooLong,
    });
    expect(checkForm({ ...form, guide: "가".repeat(1001) })).toMatchObject({ ok: false, field: "guide" });
    const items = form.items.map((item, index) => (index === 0 ? { ...item, value: "가".repeat(201) } : item));
    expect(checkForm({ ...form, items })).toMatchObject({ ok: false, field: "option" });
    // 캡처 없이 상품명과 링크만으로도 통과한다.
    expect(checkForm(form)).toMatchObject({ ok: true });
  });
});
