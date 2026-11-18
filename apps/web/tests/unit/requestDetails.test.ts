import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanRequestDetails,
  readRequestDetails,
  resetRequestDetailsForTest,
  saveRequestDetails,
} from "@/lib/requestDetails";
import * as requestStore from "@/lib/requestStore";
import type { RequestDetailsView } from "@/lib/volunteerView";

const DETAILS: RequestDetailsView = {
  summary: "소니 무선 헤드셋, 예산 십만 원",
  qa: [
    { q: "어떤 상품을 찾으세요?", a: "소니 무선 헤드셋" },
    { q: "예산은 얼마인가요?", a: "십만 원 정도" },
  ],
};

async function newRequest(): Promise<string> {
  const result = await requestStore.getRequestStore().register({
    clientRequestId: randomUUID(),
    product: "소니 무선 헤드셋",
    budget: "십만 원 정도",
    condition: "새 제품",
    brand: "Sony",
    item: "헤드셋",
    conditionKind: "new",
    deviceId: null,
  });
  return result.requestId;
}

/** 이벤트 루프를 한 바퀴 돌려 비동기 알림 처리가 끝나게 한다. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("cleanRequestDetails", () => {
  it("객체가 아니거나 요약과 질문·답이 모두 비면 null이다", () => {
    expect(cleanRequestDetails(null)).toBeNull();
    expect(cleanRequestDetails(undefined)).toBeNull();
    expect(cleanRequestDetails("요약")).toBeNull();
    expect(cleanRequestDetails([DETAILS])).toBeNull();
    expect(cleanRequestDetails({})).toBeNull();
    expect(cleanRequestDetails({ summary: "   ", qa: [] })).toBeNull();
    expect(cleanRequestDetails({ summary: 3, qa: "x" })).toBeNull();
  });

  it("말한 그대로 두고 앞뒤 공백만 정리한다", () => {
    expect(cleanRequestDetails({ summary: "  소니   무선\n헤드셋  ", qa: [{ q: " 예산은 얼마인가요? ", a: "십만 원\t정도" }] })).toEqual({
      summary: "소니 무선 헤드셋",
      qa: [{ q: "예산은 얼마인가요?", a: "십만 원 정도" }],
    });
  });

  it("제어 문자를 공백으로 바꾼다", () => {
    const cleaned = cleanRequestDetails({ summary: "가\u0000나\u0007다\u007f라", qa: [] });
    expect(cleaned?.summary).toBe("가 나 다 라");
  });

  it("상한을 글자(code point) 단위로 자르고 끝에 …를 붙인다", () => {
    const cleaned = cleanRequestDetails({
      summary: "가".repeat(301),
      qa: [{ q: "나".repeat(151), a: "다".repeat(201) }],
    });
    expect([...(cleaned?.summary ?? "")]).toHaveLength(300);
    expect(cleaned?.summary.endsWith("…")).toBe(true);
    expect([...(cleaned?.qa[0].q ?? "")]).toHaveLength(150);
    expect([...(cleaned?.qa[0].a ?? "")]).toHaveLength(200);
    expect(cleaned?.qa[0].a.endsWith("…")).toBe(true);
    // 상한 이내는 그대로, 이모지 같은 두 칸 글자도 한 글자로 센다.
    const exact = cleanRequestDetails({ summary: "😀".repeat(300), qa: [] });
    expect(exact?.summary).toBe("😀".repeat(300));
    const over = cleanRequestDetails({ summary: "😀".repeat(301), qa: [] });
    expect([...(over?.summary ?? "")]).toHaveLength(300);
  });

  it("전화번호 모양은 가린다(전각 숫자도)", () => {
    const cleaned = cleanRequestDetails({
      summary: "연락은 010-1234-5678로 주세요",
      qa: [
        { q: "연락처가 있나요?", a: "02 123 4567 입니다" },
        { q: "다른 번호는요?", a: "０１０１２３４５６７８" },
      ],
    });
    expect(cleaned?.summary).toBe("연락은 (전화번호 가림)로 주세요");
    expect(cleaned?.qa.map((pair) => pair.a)).toEqual(["(전화번호 가림) 입니다", "(전화번호 가림)"]);
    expect(JSON.stringify(cleaned)).not.toMatch(/\d{3}[-\s]?\d{4}/);
  });

  it("금액 같은 숫자는 가리지 않는다", () => {
    expect(cleanRequestDetails({ summary: "예산 100,000원", qa: [] })?.summary).toBe("예산 100,000원");
  });

  it("잘못된 짝(문자열 아님, 질문이나 답이 빔)은 버리고 앞에서 12개까지만 둔다", () => {
    const valid = Array.from({ length: 14 }, (_, i) => ({ q: `질문 ${i}`, a: `답 ${i}` }));
    const cleaned = cleanRequestDetails({
      summary: "요약",
      qa: [null, 3, "x", { q: "질문만" }, { a: "답만" }, { q: " ", a: "공백 질문" }, { q: "답이 빔", a: "  " }, { q: 1, a: 2 }, ...valid],
    });
    expect(cleaned?.qa).toHaveLength(12);
    expect(cleaned?.qa[0]).toEqual({ q: "질문 0", a: "답 0" });
    expect(cleaned?.qa[11]).toEqual({ q: "질문 11", a: "답 11" });
  });

  it("요약이 비어도 질문·답이 있으면 남기고, 질문·답이 없어도 요약이 있으면 남긴다", () => {
    expect(cleanRequestDetails({ summary: "", qa: [{ q: "예산은?", a: "십만 원" }] })).toEqual({
      summary: "",
      qa: [{ q: "예산은?", a: "십만 원" }],
    });
    expect(cleanRequestDetails({ summary: "요약", qa: [{ q: "답이 빔", a: "" }] })).toEqual({ summary: "요약", qa: [] });
  });
});

describe("메모리 저장소", () => {
  beforeEach(() => {
    vi.stubEnv("STORE_MODE", "memory");
    requestStore.resetRequestStoresForTest();
    resetRequestDetailsForTest();
  });
  afterEach(() => {
    resetRequestDetailsForTest();
    vi.unstubAllEnvs();
  });

  it("저장하고 읽는다. 같은 요청에 다시 저장해도 처음 것을 지킨다", async () => {
    const id = await newRequest();
    expect(await readRequestDetails(id)).toBeNull();
    expect(await saveRequestDetails(id, DETAILS)).toBe("saved");
    expect(await readRequestDetails(id)).toEqual(DETAILS);
    expect(await saveRequestDetails(id, { summary: "다른 말", qa: [] })).toBe("exists");
    expect(await readRequestDetails(id)).toEqual(DETAILS);
  });

  it("요청이 done이 되면 지운다", async () => {
    const id = await newRequest();
    await saveRequestDetails(id, DETAILS);
    const store = requestStore.getRequestStore();
    expect(await store.claim(id, "volunteer-a")).toBe("claimed");
    expect(await readRequestDetails(id)).toEqual(DETAILS);
    expect((await store.complete(id, "volunteer-a", [])).outcome).toBe("completed");
    await settle();
    expect(await readRequestDetails(id)).toBeNull();
  });

  it("내려놓아 대기열로 돌아가면 남긴다(다음 봉사자가 본다)", async () => {
    const id = await newRequest();
    await saveRequestDetails(id, DETAILS);
    const store = requestStore.getRequestStore();
    await store.claim(id, "volunteer-a");
    expect(await store.release(id, "volunteer-a")).toBe("released");
    await settle();
    expect(await readRequestDetails(id)).toEqual(DETAILS);
    await store.claim(id, "volunteer-b");
    expect(await readRequestDetails(id)).toEqual(DETAILS);
  });

  it("요청이 지워지면(시연 초기화) 같이 지운다", async () => {
    const store = requestStore.getRequestStore();
    await store.resetDemo(null);
    const queue = await store.listQueue("volunteer-a");
    const demo = queue.waiting.find((item) => item.isDemo);
    expect(demo).toBeDefined();
    await saveRequestDetails(demo!.requestId, DETAILS);
    expect(await readRequestDetails(demo!.requestId)).toEqual(DETAILS);
    await store.resetDemo(null);
    await settle();
    expect(await readRequestDetails(demo!.requestId)).toBeNull();
  });

  it("읽을 때도 한 번 더 거른다", async () => {
    const id = await newRequest();
    (globalThis as { __lhRequestDetails?: Map<string, unknown> }).__lhRequestDetails?.set(id, { summary: "", qa: [] });
    await saveRequestDetails(randomUUID(), DETAILS);
    (globalThis as { __lhRequestDetails?: Map<string, unknown> }).__lhRequestDetails?.set(id, { summary: "010-1234-5678", qa: [] });
    expect((await readRequestDetails(id))?.summary).toBe("(전화번호 가림)");
  });
});

describe("Supabase 저장소(가짜 클라이언트)", () => {
  type Call = { table: string; row: Record<string, unknown>; options: unknown; columns?: string };
  const ID = randomUUID();

  function fakeClient(options: { upsertResult?: { data: unknown; error: unknown }; readResult?: { data: unknown; error: unknown }; throws?: boolean }) {
    const calls: Call[] = [];
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const reads: { table: string; columns: string; column: string; value: string }[] = [];
    const client = {
      rpc,
      from: (table: string) => ({
        upsert: (row: Record<string, unknown>, upsertOptions: unknown) => ({
          select: (columns: string) => {
            if (options.throws) throw new Error("boom");
            calls.push({ table, row, options: upsertOptions, columns });
            return Promise.resolve(options.upsertResult ?? { data: [{ request_id: row.request_id }], error: null });
          },
        }),
        select: (columns: string) => ({
          eq: (column: string, value: string) => ({
            maybeSingle: () => {
              reads.push({ table, columns, column, value });
              return Promise.resolve(options.readResult ?? { data: null, error: null });
            },
          }),
        }),
      }),
    };
    return { client, calls, reads, rpc };
  }

  function useFake(fake: ReturnType<typeof fakeClient>, kind: "supabase" | "memory" = "supabase") {
    vi.spyOn(requestStore, "getRequestStore").mockReturnValue({
      storeKind: () => kind,
    } as unknown as ReturnType<typeof requestStore.getRequestStore>);
    vi.spyOn(requestStore, "getSupabaseRpcClient").mockReturnValue(fake.client as unknown as requestStore.RpcClient);
  }

  beforeEach(() => resetRequestDetailsForTest());
  afterEach(() => {
    vi.restoreAllMocks();
    resetRequestDetailsForTest();
  });

  it("upsert에 request_id·summary·qa를 넘기고 처음 것을 지킨다(ignoreDuplicates)", async () => {
    const fake = fakeClient({});
    useFake(fake);
    expect(await saveRequestDetails(ID, DETAILS)).toBe("saved");
    expect(fake.calls).toEqual([
      {
        table: "request_details",
        row: { request_id: ID, summary: DETAILS.summary, qa: DETAILS.qa },
        options: { onConflict: "request_id", ignoreDuplicates: true },
        columns: "request_id",
      },
    ]);
    // 저장 함수(rpc)는 부르지 않는다: 표가 없어도 requests 저장소의 메모리 전환(volunteerPersistent)에 영향을 주지 않는다.
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("이미 있어서 아무 행도 안 들어갔으면 exists다", async () => {
    useFake(fakeClient({ upsertResult: { data: [], error: null } }));
    expect(await saveRequestDetails(ID, DETAILS)).toBe("exists");
  });

  it("표가 없으면(PGRST205·42P01) unavailable, 그 밖의 오류와 예외는 failed다. 던지지 않는다", async () => {
    useFake(fakeClient({ upsertResult: { data: null, error: { code: "PGRST205", message: "no table" } } }));
    expect(await saveRequestDetails(ID, DETAILS)).toBe("unavailable");
    vi.restoreAllMocks();
    useFake(fakeClient({ upsertResult: { data: null, error: { code: "42P01", message: "missing" } } }));
    expect(await saveRequestDetails(ID, DETAILS)).toBe("unavailable");
    vi.restoreAllMocks();
    useFake(fakeClient({ upsertResult: { data: null, error: { code: "23514", message: "check" } } }));
    expect(await saveRequestDetails(ID, DETAILS)).toBe("failed");
    vi.restoreAllMocks();
    useFake(fakeClient({ throws: true }));
    expect(await saveRequestDetails(ID, DETAILS)).toBe("failed");
  });

  it("읽기: 행을 거르고, 없거나 오류면 null이다", async () => {
    const fake = fakeClient({ readResult: { data: { summary: " 요약 ", qa: [{ q: "예산은?", a: "십만 원" }, { q: "빔", a: "" }] }, error: null } });
    useFake(fake);
    expect(await readRequestDetails(ID)).toEqual({ summary: "요약", qa: [{ q: "예산은?", a: "십만 원" }] });
    expect(fake.reads).toEqual([{ table: "request_details", columns: "summary, qa", column: "request_id", value: ID }]);
    vi.restoreAllMocks();
    useFake(fakeClient({ readResult: { data: null, error: null } }));
    expect(await readRequestDetails(ID)).toBeNull();
    vi.restoreAllMocks();
    useFake(fakeClient({ readResult: { data: null, error: { code: "PGRST205" } } }));
    expect(await readRequestDetails(ID)).toBeNull();
  });

  it("저장소가 메모리로 떨어졌으면(표 클라이언트를 쓰지 않으면) Supabase를 부르지 않는다", async () => {
    const fake = fakeClient({});
    useFake(fake, "memory");
    expect(await saveRequestDetails(ID, DETAILS)).toBe("saved");
    expect(fake.calls).toEqual([]);
    expect(await readRequestDetails(ID)).toEqual(DETAILS);
    expect(fake.reads).toEqual([]);
  });
});
