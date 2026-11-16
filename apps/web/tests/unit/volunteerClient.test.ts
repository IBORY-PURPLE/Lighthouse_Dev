import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS } from "@/lib/speech";
import {
  claimRequest,
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
