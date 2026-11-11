import { RequestDetail } from "@/components/RequestDetail";

export default async function VolunteerRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  return <RequestDetail requestId={requestId} />;
}
