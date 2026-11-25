import type { Metadata } from "next";
import { PhonePhoto } from "@/components/PhonePhoto";

// 휴대폰 사진 페이지(노트북 QR로 연다). 링크 토큰이 주소 # 뒤에 있으므로 응답 머리글(next.config.ts headers)로
// no-store·no-referrer·noindex를 건다. 페이지 자체도 매번 새로 만든다.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "사진 올리기 - LightHouse",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function VolunteerPhotoPage() {
  return <PhonePhoto />;
}
