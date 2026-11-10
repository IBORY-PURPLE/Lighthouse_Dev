import {
  createVolunteerSession,
  VOLUNTEER_SESSION_COOKIE,
} from "@/lib/volunteerAuth";
import { REGISTERED_VOLUNTEER } from "@/lib/volunteers";

/** 시험용 로그인 쿠키 헤더 값. 가짜 계정(vitest.config.mts)으로 서명한다. */
export function sessionCookieHeader(): string {
  return `${VOLUNTEER_SESSION_COOKIE}=${createVolunteerSession(REGISTERED_VOLUNTEER.id)}`;
}
