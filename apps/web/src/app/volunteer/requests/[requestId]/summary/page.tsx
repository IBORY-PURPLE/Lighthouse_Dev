import { Suspense } from "react";
import { SummaryEditor } from "@/components/SummaryEditor";

export default async function VolunteerSummaryPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  return (
    <Suspense fallback={null}>
      <SummaryEditor requestId={requestId} />
    </Suspense>
  );
}
