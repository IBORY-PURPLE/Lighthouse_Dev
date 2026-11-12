import Link from "next/link";

// 봉사자 화면 아래 없는 주소로 들어왔을 때 보이는 안내. 기본 영어 404 대신 한국어와 돌아갈 링크를 준다.
export default function VolunteerNotFound() {
  return (
    <div className="vol-root">
      <main className="vol-page vol-page--plain">
        <h1>페이지를 찾지 못했어요</h1>
        <p className="vol-empty">주소가 바뀌었거나 없어진 페이지예요. 내 담당 목록에서 요청을 다시 열어 주세요.</p>
        <p>
          <Link href="/volunteer?tab=mine">내 담당 목록으로</Link>
        </p>
      </main>
    </div>
  );
}
