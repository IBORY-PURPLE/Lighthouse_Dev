import { NextResponse } from "next/server";
import { pushPublicKey } from "@/lib/webPush";

// 웹 푸시 공개 키(A13). 이용자 화면이 [리뷰 알림 받기]에서 구독할 때 쓴다. 키가 없으면 404 not_configured.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const publicKey = pushPublicKey();
  return publicKey
    ? NextResponse.json({ publicKey }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ ok: false, error: "not_configured" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
