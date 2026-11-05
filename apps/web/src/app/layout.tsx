import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// 페이지 효과에서 document.title을 정하면 같은 탭 이동 때 Next가 이 값으로 덮어쓴다.
// 그래서 제목은 메타데이터로만 정한다. 이용자 화면이 첫 화면이라 기본값으로 둔다.
export const metadata: Metadata = {
  title: "상품 요청 - LightHouse",
  description: "음성으로 요청하면 봉사자가 AI 조언을 받아 상품을 찾아 주는 서비스",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
