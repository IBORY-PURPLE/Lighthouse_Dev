"use client";

import { useEffect, useRef, useState } from "react";

/**
 * [요청 내려놓기] → 확인([취소][돌려놓기]). "모은 정보" 창과 위 막대의 "더 보기" 메뉴가 같이 쓴다. 돌려놓기는 같은 release()를 부른다.
 * 눌린 버튼이 사라지므로 초점을 확인 묶음의 [취소]로, 취소하면 [요청 내려놓기]로 되돌린다.
 */
export function ReleaseConfirm({ onRelease, releasing }: { onRelease: () => void; releasing: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const releaseRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const askedConfirm = useRef(false);

  useEffect(() => {
    if (confirming) {
      askedConfirm.current = true;
      cancelRef.current?.focus();
    } else if (askedConfirm.current) {
      askedConfirm.current = false;
      releaseRef.current?.focus();
    }
  }, [confirming]);

  if (confirming) {
    return (
      <div role="group" aria-label="요청 내려놓기 확인">
        <p className="vc-release-prompt">이 요청을 대기열로 돌려놓을까요? 모은 정보는 지워져요.</p>
        <div className="vc-release-row">
          <button ref={cancelRef} type="button" className="vc-btn vc-btn--small" onClick={() => setConfirming(false)}>
            취소
          </button>
          <button
            type="button"
            className="vc-btn vc-btn--small vc-btn--ink"
            aria-disabled={releasing ? true : undefined}
            onClick={() => {
              if (!releasing) onRelease();
            }}
          >
            돌려놓기
          </button>
        </div>
      </div>
    );
  }
  return (
    <button ref={releaseRef} type="button" className="vc-release-btn" onClick={() => setConfirming(true)}>
      요청 내려놓기
    </button>
  );
}
