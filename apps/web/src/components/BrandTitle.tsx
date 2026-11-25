import Link from "next/link";
import { forwardRef, type ReactNode } from "react";

/** 서비스 로고(등대 그림 + "Lighthouse" 글자, 배경 없음). 원본은 피그마 "Lighthouse Logo / Horizontal". */
const LOGO_SRC = "/brand/lighthouse-logo.svg";

/**
 * 위 막대 맨 앞의 서비스 이름(h1). 봉사자 첫 화면과 리서치 챗이 같이 쓴다.
 * 화면에는 로고 그림만 보이고, 그림의 대체 글이 "Lighthouse"라서 제목 이름은 그대로 "Lighthouse"로 읽힌다.
 * 로고는 첫 화면(/volunteer)으로 가는 링크다(뒤로 화살표 대신). 링크 이름은 "Lighthouse 첫 화면으로".
 * context는 화면 읽기 프로그램에만 읽히는 덧붙임(예: 지금 요청).
 */
export const BrandTitle = forwardRef<HTMLHeadingElement, { context?: ReactNode }>(function BrandTitle({ context }, ref) {
  return (
    <h1 ref={ref} tabIndex={-1} className="vc-topbar-title vc-brand">
      <Link href="/volunteer" className="vc-brand-link">
        {/* eslint-disable-next-line @next/next/no-img-element -- 작은 로고 한 장, 최적화 필요 없음 */}
        <img className="vc-brand-logo" src={LOGO_SRC} alt="Lighthouse" width={1420} height={378} />
        <span className="vol-sr"> 첫 화면으로</span>
      </Link>
      {context && <span className="vol-sr"> · {context}</span>}
    </h1>
  );
});
