import { cookies } from "next/headers";
import { VolunteerLogin } from "@/components/VolunteerLogin";
import { VolunteerView } from "@/components/VolunteerView";
import {
  readVolunteerSession,
  VOLUNTEER_SESSION_COOKIE,
} from "@/lib/volunteerAuth";

// 로그인 여부는 요청마다 쿠키로 판단한다.
export const dynamic = "force-dynamic";

/** 로그인 전에는 봉사자 화면 코드가 아예 그려지지 않는다. */
export default async function VolunteerPage() {
  const cookieStore = await cookies();
  const session = readVolunteerSession(
    cookieStore.get(VOLUNTEER_SESSION_COOKIE)?.value,
  );
  return session ? <VolunteerView /> : <VolunteerLogin />;
}
