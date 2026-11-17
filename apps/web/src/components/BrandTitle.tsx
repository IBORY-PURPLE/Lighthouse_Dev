import { forwardRef, type ReactNode } from "react";

/** 서비스 로고 그림 주소. 로고 파일을 public/에 두면 여기에 적는다(없으면 이름만 보인다). */
const LOGO_SRC: string | null = "/brand/lighthouse-icon.svg";

/**
 * 위 막대 맨 앞의 서비스 이름(h1). 봉사자 첫 화면과 리서치 챗이 같이 쓴다.
 * 화면에는 로고와 "Lighthouse"만 보인다. context는 화면 읽기 프로그램에만 읽히는 덧붙임(예: 지금 요청).
 */
export const BrandTitle = forwardRef<HTMLHeadingElement, { context?: ReactNode }>(function BrandTitle({ context }, ref) {
  return (
    <h1 ref={ref} tabIndex={-1} className="vc-topbar-title vc-brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- 작은 로고 한 장, 최적화 필요 없음 */}
      {LOGO_SRC && <img className="vc-brand-logo" src={LOGO_SRC} alt="" width={28} height={28} />}
      <span>Lighthouse</span>
      {context && <span className="vol-sr"> · {context}</span>}
    </h1>
  );
});
