import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS } from "@/lib/speech";
import {
  claimRequest,
  enterVolunteer,
  failureMessage,
  fetchQueue,
  releaseRequest,
  sendResult,
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

  it("보내기: 201·200 sent, 400 invalid_url, 403·404 내 담당 아님, 401, 그 밖은 failed", async () => {
    const candidates = [{ name: "N", url: "https://a.example", guide: "", summary: [] }];
    respond(201, { requestId: "r1", status: "done", sentAt: "2026-11-12T00:00:00.000Z" });
    expect(await sendResult("r1", candidates)).toEqual({ kind: "sent", sentAt: "2026-11-12T00:00:00.000Z" });
    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/volunteer/requests/r1/result");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ candidates });
    respond(200, { requestId: "r1", status: "done", sentAt: "2026-11-12T00:00:00.000Z" });
    expect((await sendResult("r1", candidates)).kind).toBe("sent");
    respond(400, { ok: false, error: "invalid_url" });
    expect(await sendResult("r1", candidates)).toEqual({ kind: "invalid_url" });
    respond(400, { ok: false, error: "too_long" });
    expect(await sendResult("r1", candidates)).toMatchObject({ kind: "failed" });
    respond(403, { ok: false, error: "not_yours" });
    expect(await sendResult("r1", candidates)).toEqual({ kind: "not_yours" });
    respond(404, { ok: false, error: "not_found" });
    expect(await sendResult("r1", candidates)).toEqual({ kind: "not_yours" });
    respond(401, { ok: false, error: "unauthorized" });
    expect(await sendResult("r1", candidates)).toEqual({ kind: "unauthorized" });
    respond(503, { ok: false, error: "store_unavailable" });
    expect(await sendResult("r1", candidates)).toEqual({
      kind: "failed",
      message: "서버에 연결하지 못했습니다. 다시 시도해 주세요.",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await sendResult("r1", candidates)).kind).toBe("failed");
  });

  it("입장: 정해진 문구", async () => {
    respond(200, { ok: true });
    expect(await enterVolunteer("code", "민지")).toEqual({ kind: "ok" });
    respond(401, { ok: false, error: "invalid_code" });
    expect(await enterVolunteer("bad", "민지")).toEqual({
      kind: "error",
      message: "입장 코드가 올바르지 않습니다",
    });
    respond(400, { ok: false, error: "invalid_nickname" });
    expect(await enterVolunteer(null, "")).toEqual({
      kind: "error",
      message: "별명은 1~12자로 넣어 주세요",
    });
    respond(429, { ok: false, error: "rate_limited" });
    expect(await enterVolunteer("c", "민지")).toEqual({
      kind: "error",
      message: "시도가 너무 많습니다. 10분 뒤 다시 해 주세요.",
    });
    respond(503, { ok: false, error: "not_configured" });
    expect(await enterVolunteer("c", "민지")).toMatchObject({ kind: "error" });
  });

  it("입장 요청 본문: 코드가 필요 없는 기기는 code를 보내지 않는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await enterVolunteer(null, "민지");
    await enterVolunteer("abc", "민지");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ nickname: "민지" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ code: "abc", nickname: "민지" });
  });
});
