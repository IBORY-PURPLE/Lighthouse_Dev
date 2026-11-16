import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";

// 대화형 리서치 챗 화면 시험용 서버 가로채기. 서버 라우트(design.md 3.2)가 stage에 병합되기 전에는 고정 응답을 돌려준다.
// 가로채기는 이 파일 한 곳에 모았다. 통합 단계에서 `installResearchMock` 호출을 실제 서버(LLM_MODE=mock) 흐름으로 바꾼다.
// 응답 파일은 tests/e2e/fixtures/research/*.json(design.md 3.2 모양). 요청 본문 모양도 여기서 확인한다.

export const REQUEST_ID = "req-e2e-1";

/** 읽을 수 있는 1x1 PNG(사진 올리기 시험용). */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/research", `${name}.json`), "utf-8")) as Json;
}

export interface MockCall {
  method: string;
  /** 요청 번호 뒤 경로(예: "/research/turn", "" 는 상세). */
  path: string;
  body: Json | null;
}

export interface MockOptions {
  /** 턴 응답을 늦춘다(ms). 생각 중 표시와 움직임 줄이기 확인용. */
  turnDelayMs?: number;
  /** 혜택 검색을 202 + 폴링으로 돌려준다(기본 true). */
  slowBenefits?: boolean;
}

export interface MockHandle {
  calls: MockCall[];
  /** 다음 턴 하나를 이 상태 코드·오류로 실패시킨다. */
  failNextTurn: (status: number, error: string) => void;
  view: () => Json;
}

function turnFixtureFor(input: Json): string | null {
  const type = input.type;
  if (type === "quick" && input.replyId === "purchase.bought") return "turn-bought";
  if (type === "quick" && input.replyId === "purchase.research") return "turn-research";
  if (type === "chip" && input.slot === "model") return "turn-chip-model";
  if (type === "chip" && input.slot === "alts") return "turn-alt-pick";
  if (type === "text" && String(input.text).includes("가볍고 귀가")) return "turn-pros";
  if (type === "text" && String(input.text).includes("소음 차단")) return "turn-reason";
  if (type === "text" && String(input.text).includes("카드 할인")) return "turn-benefits-exp";
  if (type === "link_check") return "turn-link-check";
  if (type === "quick" && input.replyId === "skip.refs") return "turn-skip-refs";
  return null;
}

function mergeMessages(current: Json[], incoming: Json[]): Json[] {
  const bySeq = new Map<number, Json>();
  for (const message of [...current, ...incoming]) bySeq.set(message.seq as number, message);
  return [...bySeq.values()].sort((a, b) => (a.seq as number) - (b.seq as number));
}

export async function installResearchMock(page: Page, options: MockOptions = {}): Promise<MockHandle> {
  const state = {
    view: fixture("get-hero"),
    detail: fixture("detail-in-progress"),
    photos: [] as Json[],
    failTurn: null as { status: number; error: string } | null,
    pendingSearch: null as Json | null,
  };
  const calls: MockCall[] = [];
  const slow = options.slowBenefits ?? true;

  const apply = (messages: Json[] | undefined, session?: Json, version?: number) => {
    const next = { ...state.view, ...(session ?? {}) } as Json;
    const merged = mergeMessages((state.view.messages as Json[]) ?? [], messages ?? []);
    next.messages = merged;
    next.lastSeq = Math.max(0, ...merged.map((message) => Math.ceil(message.seq as number)));
    if (typeof version === "number") next.version = version;
    state.view = next;
  };

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route(`**/api/volunteer/requests/${REQUEST_ID}**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const tail = url.pathname.split(`/${REQUEST_ID}`)[1] ?? "";
    const method = request.method();
    let body: Json | null = null;
    try {
      body = request.postDataJSON() as Json | null;
    } catch {
      body = null;
    }
    calls.push({ method, path: tail, body });

    if (tail === "" && method === "GET") return json(route, 200, state.detail);

    if (tail === "/research" && method === "GET") {
      if (state.pendingSearch) {
        const done = state.pendingSearch;
        state.pendingSearch = null;
        apply(done.messages as Json[]);
        state.view = { ...state.view, pending: {} };
      }
      return json(route, 200, { ...state.view, photos: state.photos });
    }

    if (tail === "/research/turn" && method === "POST") {
      if (options.turnDelayMs) await new Promise((resolve) => setTimeout(resolve, options.turnDelayMs));
      if (state.failTurn) {
        const failure = state.failTurn;
        state.failTurn = null;
        return json(route, failure.status, { error: failure.error });
      }
      const name = turnFixtureFor((body?.input as Json) ?? {});
      if (!name) return json(route, 500, { error: "mock_unhandled", input: body?.input ?? null });
      const turn = fixture(name);
      apply(turn.messages as Json[], turn.session as Json, turn.version as number);
      return json(route, 200, turn);
    }

    if (tail === "/research/search" && method === "POST") {
      const kind = String(body?.kind);
      const found = fixture(`search-${kind}`);
      if (kind === "benefits" && slow) {
        state.pendingSearch = found;
        state.view = { ...state.view, pending: { search: { kind: "benefits" } } };
        return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ pending: true }) });
      }
      apply(found.messages as Json[]);
      return json(route, 200, found);
    }

    if (tail === "/research/photos" && method === "POST") {
      const image = String(body?.image ?? "");
      const thumb = String(body?.thumb ?? "");
      if (!image.startsWith("data:image/jpeg") || !thumb.startsWith("data:image/jpeg") || thumb.length > 60_000) {
        return json(route, 415, { error: "bad_image" });
      }
      const added = fixture("photo-added");
      state.photos = [...state.photos, { ...(added.photo as Json), thumb }];
      apply(added.messages as Json[], added.session as Json, added.version as number);
      return json(route, 201, { photo: state.photos[state.photos.length - 1], messages: added.messages });
    }

    if (tail.startsWith("/research/photos/") && method === "DELETE") {
      const id = decodeURIComponent(tail.split("/").pop() ?? "");
      state.photos = state.photos.filter((photo) => photo.id !== id);
      const slots = { ...(state.view.slots as Json) };
      delete slots.photo;
      state.view = { ...state.view, slots, verified: false };
      return json(route, 200, { session: state.view });
    }

    if (tail === "/research/review" && method === "POST") {
      const draft = fixture("review-draft");
      state.view = { ...state.view, stage: "review", review: draft.review };
      return json(route, 200, draft);
    }

    if (tail === "/research/review" && method === "PUT") {
      const text = String(body?.text ?? "");
      if (/\d+\s*(만\s*)?원/.test(text)) return json(route, 422, fixture("review-blocked"));
      const review = { status: "confirmed", rev: 1, text };
      state.view = { ...state.view, review };
      return json(route, 200, { review });
    }

    if (tail === "/research/send" && method === "POST") {
      const review = state.view.review as Json;
      if (review.status !== "confirmed") return json(route, 409, { error: "review_not_confirmed" });
      state.detail = fixture("detail-done");
      state.view = { ...state.view, stage: "sent" };
      return json(route, 201, fixture("send-done"));
    }

    return json(route, 404, { error: "mock_no_route", tail, method });
  });

  return {
    calls,
    failNextTurn: (status, error) => {
      state.failTurn = { status, error };
    },
    view: () => state.view,
  };
}
