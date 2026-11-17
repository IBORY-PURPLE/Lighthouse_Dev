import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/researchClient";
import { readSentHistory, saveSentHistory, SENT_HISTORY_KEY, SENT_HISTORY_TTL_MS, toHistoryLines } from "@/lib/sentHistory";

const messages: ChatMessage[] = [
  { seq: 1, role: "volunteer", body: { text: "구매했어요" } },
  { seq: 2, role: "ai", tag: "question", slot: "model", body: { text: "어떤 기종을 쓰고 계세요?" } },
  { seq: 3, role: "ai", body: { kind: "chips", chips: [] } },
  { seq: 4, role: "volunteer", body: { kind: "photo", photoId: "p1" } },
];

/** 메모리 저장소(jsdom 없이). */
function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
}

describe("sentHistory(완료 건 대화 이력, 이 기기 30일)", () => {
  beforeEach(() => stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("글이 있는 메시지만 줄로 남기고 사진은 글로 바꾼다", () => {
    const lines = toHistoryLines(messages);
    expect(lines.map((line) => line.text)).toEqual(["구매했어요", "어떤 기종을 쓰고 계세요?", "사진을 올렸어요."]);
    expect(lines[1].chip).toBe("칸 질문");
    expect(JSON.stringify(lines)).not.toContain("p1");
  });

  it("저장한 이력을 읽고, 30일이 지나면 지운다", () => {
    const now = Date.now();
    saveSentHistory("req-1", messages, now);
    expect(readSentHistory("req-1", now + 1000)?.length).toBe(3);
    expect(readSentHistory("req-1", now + SENT_HISTORY_TTL_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(SENT_HISTORY_KEY)).toBeNull();
  });

  it("고장 난 저장값은 무시한다", () => {
    window.localStorage.setItem(SENT_HISTORY_KEY, "{not json");
    expect(readSentHistory("req-1")).toBeNull();
  });
});
