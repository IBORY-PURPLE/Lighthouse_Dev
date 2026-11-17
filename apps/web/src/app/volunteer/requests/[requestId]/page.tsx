import { ResearchConversation } from "@/components/research/ResearchConversation";

export default async function VolunteerRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  // 왼쪽 창의 완료 항목을 누르면 같은 화면 틀에서 요청만 바뀐다. key로 상태를 새로 시작한다.
  return <ResearchConversation key={requestId} requestId={requestId} />;
}
