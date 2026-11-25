import { ClientOnly } from "@/components/ClientOnly";
import { ResearchConversation } from "@/components/research/ResearchConversation";

export default async function VolunteerRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  // 왼쪽 창의 완료 항목을 누르면 같은 화면 틀에서 요청만 바뀐다. key로 상태를 새로 시작한다.
  // 창 열림·폭을 브라우저 저장값으로 정하므로 브라우저에서만 그린다(서버 HTML과 어긋나지 않게).
  return (
    <ClientOnly>
      <ResearchConversation key={requestId} requestId={requestId} />
    </ClientOnly>
  );
}
