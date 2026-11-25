import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import {
  cookieSecure,
  hashedKeyId,
  issueSignedKey,
  readSignedKey,
} from "./volunteerSession";

// 이용자 기기 열쇠. 계정 없이 이 기기가 보낸 요청만 보게 한다(봉사자 lh_vol과 같은 서명 방식, 비밀만 다르다).
// 쿠키 lh_device = v1.<열쇠>.<서명>. DB(requests.device_id)와 로그에는 열쇠에서 뽑은 기기 ID(u-+32자리)만 남는다.

export const DEVICE_COOKIE = "lh_device";
/** 1년. */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const PURPOSE = "request-device";

/** 쿠키 값이 맞으면 기기 ID, 아니면 null. */
export function readDeviceId(value: string | null | undefined): string | null {
  const key = readSignedKey(PURPOSE, value);
  return key ? `u-${hashedKeyId(key, 32)}` : null;
}

export interface DeviceIdentity {
  /** 서명 비밀이 없으면 null(기기를 구분하지 못한다). */
  deviceId: string | null;
  /** 새로 심어야 할 쿠키 값. 이미 맞는 쿠키가 있으면 null. */
  issued: string | null;
}

/** 요청의 lh_device가 맞으면 그 기기, 없거나 틀리면 새 기기 ID를 만든다(쿠키는 응답에 applyDeviceCookie로 심는다). */
export function resolveDevice(request: NextRequest): DeviceIdentity {
  const current = readDeviceId(request.cookies.get(DEVICE_COOKIE)?.value);
  if (current) return { deviceId: current, issued: null };
  const issued = issueSignedKey(PURPOSE);
  return { deviceId: issued ? readDeviceId(issued) : null, issued };
}

/** 요청의 lh_device가 맞으면 기기 ID, 아니면 null. 새로 발급하지 않는다. */
export function currentDeviceId(request: NextRequest): string | null {
  return readDeviceId(request.cookies.get(DEVICE_COOKIE)?.value);
}

/** 새로 발급한 쿠키를 응답에 심는다. 봉사자 쿠키와 같은 속성이다. */
export function applyDeviceCookie(
  response: NextResponse,
  request: NextRequest,
  identity: DeviceIdentity,
): void {
  if (!identity.issued) return;
  response.cookies.set({
    name: DEVICE_COOKIE,
    value: identity.issued,
    httpOnly: true,
    secure: cookieSecure(request),
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
}
