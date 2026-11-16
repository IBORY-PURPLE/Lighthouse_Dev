import { ResearchChat } from "@/components/ResearchChat";

export default async function VolunteerRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  return <ResearchChat requestId={requestId} />;
}
