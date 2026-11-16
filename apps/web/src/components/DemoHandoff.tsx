"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { requestMatch, saveMatch } from "@/lib/matchHandoff";

interface DemoHandoffProps {
  /** 이용자가 답한 찾는 제품. 시연 이어 보기용 /api/match에 보낸다. */
  product: string;
  /** 이어 보기에 실패하면 상태 영역에 읽을 문구를 넘긴다. 대기번호 화면은 그대로다. */
  onFailed: (status: string) => void;
}

/**
 * 시연 예외: 같은 탭에서 봉사자 화면으로 이어 본다. 접수 완료(대기번호) 화면에서만 그린다.
 * 누르면 /api/match로 시연 봉사자를 정하고 lh.match.v1에 저장한 뒤 /volunteer/demo로 간다(notes C1).
 */
export function DemoHandoff({ product, onFailed }: DemoHandoffProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = async () => {
    if (busy) return;
    // Safari는 눌린 버튼에 초점을 주지 않는다. 실패 안내 뒤에도 이 버튼에서 다시 누를 수 있게 둔다.
    buttonRef.current?.focus();
    setBusy(true);
    const outcome = await requestMatch(product);
    if (outcome.kind === "matched") {
      saveMatch(outcome.match);
      router.push("/volunteer/demo");
      return;
    }
    setBusy(false);
    onFailed(outcome.status);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className="big-button"
      aria-disabled={busy ? true : undefined}
      onClick={handleClick}
    >
      봉사자 화면으로(시연)
    </button>
  );
}
