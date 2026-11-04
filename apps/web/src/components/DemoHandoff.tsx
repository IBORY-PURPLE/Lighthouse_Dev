"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** 시연 예외: 같은 탭에서 봉사자 화면으로 이어 본다. 매칭 완료 후에만 그린다. */
export function DemoHandoff() {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="big-button"
      onClick={() => router.push("/volunteer")}
    >
      봉사자 화면으로(시연)
    </button>
  );
}
