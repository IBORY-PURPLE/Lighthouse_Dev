import "server-only";
import webpush from "web-push";
import { getSupabaseRpcClient } from "./requestStore";

/**
 * 이용자 리뷰 도착 웹 푸시(A13, 2026-11-17 이용자 결정). 서버 전용.
 * - 구독: 이용자 화면이 [리뷰 알림 받기]로 받은 PushSubscription을 요청 번호마다 하나 저장한다(Supabase push_subscriptions, 없으면 메모리).
 * - 보내기: 봉사자가 리뷰를 보내면 그 요청의 구독으로 알림을 한 번 보내고 구독을 지운다. 알림을 누르면 /?request=<id>로 열린다.
 * - 키: VAPID_PUBLIC_KEY·VAPID_PRIVATE_KEY(Vercel 환경 변수). 없으면 알림 기능은 조용히 꺼진다.
 */

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 브라우저가 준 구독 JSON({endpoint, keys:{p256dh, auth}})을 검사한다. 틀리면 null. */
export function parseSubscription(value: unknown): PushSubscriptionInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
  const p256dh = typeof record.keys?.p256dh === "string" ? record.keys.p256dh.trim() : "";
  const auth = typeof record.keys?.auth === "string" ? record.keys.auth.trim() : "";
  if (!/^https:\/\/[^\s]{4,}$/.test(endpoint) || endpoint.length > 1000) return null;
  if (!/^[A-Za-z0-9_\-=+/]{1,200}$/.test(p256dh) || !/^[A-Za-z0-9_\-=+/]{1,100}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

/** 공개 키(이용자 화면이 구독할 때 쓴다). 없으면 null. */
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function pushPrivateKey(): string | null {
  return process.env.VAPID_PRIVATE_KEY?.trim() || null;
}

// ---------- 저장 ----------

interface TableClient {
  from(table: string): {
    upsert(row: Record<string, unknown>, options?: { onConflict?: string }): PromiseLike<{ error: unknown }>;
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } };
    delete(): { eq(column: string, value: string): PromiseLike<{ error: unknown }> };
  };
}

const memory = (globalThis as typeof globalThis & { __lhPushSubs?: Map<string, PushSubscriptionInput> });

function memoryMap(): Map<string, PushSubscriptionInput> {
  memory.__lhPushSubs ??= new Map();
  return memory.__lhPushSubs;
}

function tableClient(): TableClient | null {
  return getSupabaseRpcClient() as unknown as TableClient | null;
}

/** 요청의 구독을 저장한다(있으면 바꾼다). */
export async function savePushSubscription(requestId: string, subscription: PushSubscriptionInput): Promise<void> {
  const client = tableClient();
  if (!client) {
    memoryMap().set(requestId, subscription);
    return;
  }
  const { error } = await client
    .from("push_subscriptions")
    .upsert({ request_id: requestId, ...subscription, created_at: new Date().toISOString() }, { onConflict: "request_id" });
  if (error) throw new Error("push_subscriptions upsert failed");
}

/** 요청의 구독을 꺼내고 지운다(한 번만 보낸다). */
async function takePushSubscription(requestId: string): Promise<PushSubscriptionInput | null> {
  const client = tableClient();
  if (!client) {
    const found = memoryMap().get(requestId) ?? null;
    memoryMap().delete(requestId);
    return found;
  }
  const read = await client.from("push_subscriptions").select("endpoint, p256dh, auth").eq("request_id", requestId).maybeSingle();
  if (read.error || !read.data) return null;
  await client.from("push_subscriptions").delete().eq("request_id", requestId);
  return parseSubscription({
    endpoint: (read.data as { endpoint?: unknown }).endpoint,
    keys: { p256dh: (read.data as { p256dh?: unknown }).p256dh, auth: (read.data as { auth?: unknown }).auth },
  });
}

// ---------- 보내기 ----------

export type PushOutcome = "sent" | "no_subscription" | "no_keys" | "failed";

/** 리뷰가 도착했다고 이용자 기기에 알린다. 실패해도 보내기 흐름은 그대로다(이용자는 목록에서 다시 확인할 수 있다). */
export async function notifyReviewSent(requestId: string, product: string): Promise<PushOutcome> {
  const publicKey = pushPublicKey();
  const privateKey = pushPrivateKey();
  if (!publicKey || !privateKey) return "no_keys";
  let subscription: PushSubscriptionInput | null;
  try {
    subscription = await takePushSubscription(requestId);
  } catch {
    return "failed";
  }
  if (!subscription) return "no_subscription";
  const name = product.trim().slice(0, 40) || "요청하신 상품";
  const payload = JSON.stringify({
    title: "Lighthouse",
    body: `${name} 리뷰가 도착했어요. 눌러서 들어 보세요.`,
    url: `/?request=${requestId}`,
  });
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || "https://lighthouse-web-five.vercel.app", publicKey, privateKey);
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
      { TTL: 24 * 60 * 60, urgency: "high" },
    );
    return "sent";
  } catch {
    return "failed";
  }
}
