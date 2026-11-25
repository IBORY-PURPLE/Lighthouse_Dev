import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn(async () => ({ statusCode: 201 })) }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

import { POST as subscribe } from "@/app/api/requests/[requestId]/push/route";
import { POST as register } from "@/app/api/requests/route";
import * as requestStore from "@/lib/requestStore";
import { notifyReviewSent, parseSubscription } from "@/lib/webPush";

const ORIGIN = "http://localhost:3000";
const SUB = { endpoint: "https://push.example.com/abc", keys: { p256dh: "BPk3-key_value", auth: "auth-value" } };
const headers = () => ({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}-${randomUUID()}` });

async function newRequest(): Promise<string> {
  const body = { clientRequestId: randomUUID(), product: "소니 무선 헤드셋", budget: "10만 원", condition: "새 제품" };
  const response = await register(new NextRequest(`${ORIGIN}/api/requests`, { method: "POST", body: JSON.stringify(body), headers: headers() }));
  return (await response.json()).requestId;
}

function postSub(id: string, body: unknown) {
  return subscribe(new NextRequest(`${ORIGIN}/api/requests/${id}/push`, { method: "POST", body: JSON.stringify(body), headers: { ...headers(), "content-type": "application/json" } }), {
    params: Promise.resolve({ requestId: id }),
  });
}

describe("웹 푸시(A13)", () => {
  beforeEach(() => {
    vi.stubEnv("STORE_MODE", "memory");
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    requestStore.resetRequestStoresForTest();
    sendNotification.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("구독 모양을 검사한다(https 주소, 키 글자)", () => {
    expect(parseSubscription(SUB)).toEqual({ endpoint: SUB.endpoint, p256dh: "BPk3-key_value", auth: "auth-value" });
    expect(parseSubscription({ ...SUB, endpoint: "http://push.example.com/abc" })).toBeNull();
    expect(parseSubscription({ endpoint: SUB.endpoint, keys: { p256dh: "a b", auth: "x" } })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });

  it("구독을 붙이면 보낼 때 한 번 알리고 지운다(알림을 누르면 /?request=<id>)", async () => {
    const id = await newRequest();
    expect((await postSub(id, SUB)).status).toBe(201);
    expect(await notifyReviewSent(id, "소니 무선 헤드셋")).toBe("sent");
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [target, payload] = sendNotification.mock.calls[0] as unknown as [unknown, string];
    expect(target).toEqual({ endpoint: SUB.endpoint, keys: SUB.keys });
    expect(JSON.parse(payload)).toEqual({ title: "Lighthouse", body: "소니 무선 헤드셋 리뷰가 도착했어요. 눌러서 들어 보세요.", url: `/?request=${id}` });
    expect(await notifyReviewSent(id, "소니 무선 헤드셋")).toBe("no_subscription");
  });

  it("키가 없으면 구독을 받지 않고 보내지도 않는다", async () => {
    const id = await newRequest();
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    expect((await postSub(id, SUB)).status).toBe(404);
    expect(await notifyReviewSent(id, "x")).toBe("no_keys");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("틀린 구독·없는 요청·UUID 아님은 거절한다", async () => {
    const id = await newRequest();
    expect((await postSub(id, { endpoint: "nope" })).status).toBe(400);
    expect((await postSub(randomUUID(), SUB)).status).toBe(404);
    expect((await postSub("not-a-uuid", SUB)).status).toBe(400);
  });
});
