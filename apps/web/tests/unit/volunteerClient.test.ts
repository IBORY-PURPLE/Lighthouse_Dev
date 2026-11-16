import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS } from "@/lib/speech";
import {
  claimRequest,
  clearLegacyDrafts,
  enterVolunteer,
  failureMessage,
  fetchQueue,
  releaseRequest,
} from "@/lib/volunteerClient";

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("volunteerClient", () => {
  it("실패 안내: 429는 이용자 화면과 같은 문구, 그 밖은 연결 실패 문구", () => {
    expect(failureMessage(429)).toBe(STATUS.tooMany);
    expect(failureMessage(500)).toBe("서버에 연결하지 못했습니다. 다시 시도해 주세요.");
    expect(failureMessage(0)).toBe("서버에 연결하지 못했습니다. 다시 시도해 주세요.");
  });

  it("목록: 401은 unauthorized, 네트워크 오류는 failed", async () => {
    respond(401, { ok: false, error: "unauthorized" });
    expect(await fetchQueue()).toEqual({ kind: "unauthorized" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchQueue()).toMatchObject({ kind: "failed", status: 0 });
  });

  it("맡기: 200 claimed, 409 taken/busy, 404, 429", async () => {
    respond(200, { outcome: "claimed", requestId: "r1" });
    expect(await claimRequest("r1")).toEqual({ kind: "claimed", requestId: "r1" });
    respond(409, { ok: false, error: "already_claimed" });
    expect(await claimRequest("r1")).toEqual({ kind: "taken" });
    respond(409, { ok: false, error: "busy" });
    expect(await claimRequest("r1")).toEqual({ kind: "busy" });
    respond(404, { ok: false, error: "not_found" });
    expect(await claimRequest("r1")).toEqual({ kind: "not_found" });
    respond(429, { ok: false, error: "rate_limited" });
    expect(await claimRequest("r1")).toEqual({ kind: "failed", message: STATUS.tooMany });
    respond(401, { ok: false, error: "unauthorized" });
    expect(await claimRequest("r1")).toEqual({ kind: "unauthorized" });
  });

  it("내려놓기: 200 released, 403·404는 내 담당 아님", async () => {
    respond(200, { requestId: "r1", status: "waiting" });
    expect(await releaseRequest("r1")).toEqual({ kind: "released" });
    respond(403, { ok: false, error: "not_yours" });
    expect(await releaseRequest("r1")).toEqual({ kind: "not_yours" });
    respond(404, { ok: false, error: "not_found" });
    expect(await releaseRequest("r1")).toEqual({ kind: "not_yours" });
  });

  it("입장: 코드·별명 없이 본문 없는 POST를 보낸다. 실패하면 연결 실패 문구", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await enterVolunteer()).toEqual({ kind: "ok" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/volunteer/enter");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    respond(503, { ok: false, error: "not_configured" });
    expect(await enterVolunteer()).toEqual({
      kind: "error",
      message: "서버에 연결하지 못했습니다. 다시 시도해 주세요.",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await enterVolunteer()).toMatchObject({ kind: "error" });
  });
});

describe("clearLegacyDrafts", () => {
  class FakeStorage {
    private items = new Map<string, string>();
    get length() {
      return this.items.size;
    }
    key(index: number) {
      return [...this.items.keys()][index] ?? null;
    }
    getItem(key: string) {
      return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.items.set(key, value);
    }
    removeItem(key: string) {
      this.items.delete(key);
    }
  }

  it("옛 카드형 리서치 상태(lh.vol.research.v1.*)와 요약 초안(lh.vol.draft.v1.*)만 지우고 다른 키는 둔다", () => {
    const storage = new FakeStorage();
    storage.setItem("lh.vol.research.v1.x", "{}");
    storage.setItem("lh.vol.draft.v1.y", "초안");
    storage.setItem("lh.vol.seen.v1", "[]");
    storage.setItem("unrelated", "1");
    vi.stubGlobal("window", { localStorage: storage });
    clearLegacyDrafts();
    expect(storage.getItem("lh.vol.research.v1.x")).toBeNull();
    expect(storage.getItem("lh.vol.draft.v1.y")).toBeNull();
    expect(storage.getItem("lh.vol.seen.v1")).toBe("[]");
    expect(storage.getItem("unrelated")).toBe("1");
  });

  it("저장소를 못 읽어도 던지지 않는다", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => clearLegacyDrafts()).not.toThrow();
  });
});
