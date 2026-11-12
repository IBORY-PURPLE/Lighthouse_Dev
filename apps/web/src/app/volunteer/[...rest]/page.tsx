import { notFound } from "next/navigation";

// /volunteer 아래의 없는 주소(예: 지워진 옛 요약 화면 /volunteer/requests/<id>/summary)를 봉사자용 404(../not-found.tsx)로 보낸다.
// 루트 404는 이용자 화면과 같이 쓰므로 바꾸지 않는다.
export default function VolunteerUnknownPath() {
  notFound();
}
