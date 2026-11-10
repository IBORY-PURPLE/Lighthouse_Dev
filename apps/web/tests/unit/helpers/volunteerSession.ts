import {
  createVolunteerSession,
  VOLUNTEER_SESSION_COOKIE,
} from "@/lib/volunteerAuth";
import { REGISTERED_VOLUNTEER } from "@/lib/volunteers";

/** 가짜 계정 값. vitest.config.mts의 test.env에서만 정하고, 시험은 여기서 읽는다. */
export function fakeAccount(): {
  phone: string;
  phoneDigits: string;
  password: string;
} {
  const phone = process.env.VOLUNTEER_PHONE;
  const password = process.env.VOLUNTEER_PASSWORD;
  if (!phone || !password) {
    throw new Error("vitest.config.mts의 test.env에 가짜 계정이 없습니다.");
  }
  return { phone, phoneDigits: phone.replace(/\D/g, ""), password };
}

/** 시험용 로그인 쿠키 헤더 값. 가짜 계정(vitest.config.mts)으로 서명한다. */
export function sessionCookieHeader(): string {
  return `${VOLUNTEER_SESSION_COOKIE}=${createVolunteerSession(REGISTERED_VOLUNTEER.id)}`;
}
