"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};

/**
 * 브라우저에서만 children을 그린다(서버 HTML에는 없다).
 * 왼쪽 창 열림·폭처럼 브라우저 저장값으로 정하는 화면이 서버 HTML과 어긋나(hydration mismatch) 경고가 나지 않게 한다.
 */
export function ClientOnly({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted ? children : null;
}
