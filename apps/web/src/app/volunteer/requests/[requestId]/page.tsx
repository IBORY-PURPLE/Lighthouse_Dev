import { ResearchConversation } from "@/components/research/ResearchConversation";

export default async function VolunteerRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  return <ResearchConversation requestId={requestId} />;
}
