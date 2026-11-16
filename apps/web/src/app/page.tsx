import { UserHome } from "@/components/UserHome";

// 기본은 AI 대화. /?basic=1이면 고정 질문 3개(플로우 A)로 시작한다.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { basic } = await searchParams;
  return <UserHome basic={basic === "1"} />;
}
