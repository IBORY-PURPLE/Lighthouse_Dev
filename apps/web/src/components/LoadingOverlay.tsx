"use client";

import { LoaderCircleIcon, type LoaderCircleIconHandle } from "@animateicons/react/lucide";
import { useEffect, useRef } from "react";

/** 아이콘 한 바퀴(0.9초)가 끝나는 때에 맞춰 다시 돌린다. */
const LOOP_MS = 1000;

/**
 * 불러오는 중 덮개. 뒤의 히어로 배경과 화면은 그대로 두고, 가운데에 돌아가는 로딩 아이콘과 한 줄 안내만 얹는다.
 * `@animateicons/react`의 LoaderCircleIcon은 한 번 부르면 한 바퀴만 도므로 startAnimation을 반복해서 부른다.
 * 모션 줄이기 설정이면 아이콘이 스스로 멈추고(그림만 보임) 안내 글자가 뜻을 전한다.
 * 부모 안(position: relative인 칸)을 덮는다. 맡기 → 화면 이동 → 요청 읽기 동안 같은 모습이 이어지도록
 * 이동한 뒤 화면은 `instant`로 그려 덮개가 또 새로 떠오르지 않게 한다.
 */
export function LoadingOverlay({ label = "불러오는 중이에요", instant = false }: { label?: string; instant?: boolean }) {
  const iconRef = useRef<LoaderCircleIconHandle>(null);

  useEffect(() => {
    iconRef.current?.startAnimation();
    const timer = window.setInterval(() => iconRef.current?.startAnimation(), LOOP_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`vc-loading${instant ? " vc-loading--instant" : ""}`} role="status" data-testid="loading-overlay">
      <div className="vc-loading-card">
        <span className="vc-loading-badge" aria-hidden="true">
          <LoaderCircleIcon ref={iconRef} size={36} />
        </span>
        <p className="vc-loading-text">{label}</p>
      </div>
    </div>
  );
}
