import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { claimRequest, fetchQueue, readSeen, saveSeen, type QueueResponse } from "./volunteerClient";
import { isWideScreen } from "./usePanels";
import { newRequestIds, VOLUNTEER_MESSAGES } from "./volunteerView";

/** 왼쪽 창 id. 위 막대 버튼의 aria-controls가 가리킨다. */
export const SIDE_PANE_ID = "vol-mine";

export type PaneSection = "queue" | "mine";

interface Options {
  /** 초점을 옮길 요소들. 화면이 ref를 만들어 넘긴다(훅이 돌려주면 그리는 중에 읽는 것으로 보여 린트가 막는다). */
  toggleRef: RefObject<HTMLButtonElement | null>;
  queueHeadingRef: RefObject<HTMLHeadingElement | null>;
  mineHeadingRef: RefObject<HTMLHeadingElement | null>;
  /** 왼쪽 창 열림(두 창 상태는 usePanels가 갖는다). remember가 false면 저장하지 않는다. */
  open: boolean;
  setOpen: (open: boolean, remember?: boolean) => void;
  /** 쿠키가 없어졌거나 틀리면(401). */
  onUnauthorized: () => void;
  /** 상태 줄에 알릴 글자. */
  say: (text: string) => void;
  /** 처음 읽기가 끝났을 때 한 번. 첫 화면이 "돌아온 안내"를 보이고 창을 여는 데 쓴다. */
  onFirstLoad?: (data: QueueResponse, setOpen: (open: boolean) => void) => void;
  /** 창 맨 위 토글에서 처음 고른 쪽. 첫 화면은 대기열, 리서치 화면은 내 담당. */
  initialSection?: PaneSection;
}

/**
 * 왼쪽 창(대기열 + 내 담당)의 열림과 데이터. 첫 화면과 리서치 화면이 같이 쓴다.
 * 열림은 넓은 화면은 열린 채, 좁은 화면은 닫힌 채 시작한다. 이 훅은 브라우저에서만 그려지는 화면(입장 확인과 요청 읽기가 끝난 뒤)이 쓴다.
 * 겹친 창은 Esc로 닫고, 초점은 연 버튼으로 돌려준다. 서버는 열 때·[새로 보기]·맡기·초기화 뒤에만 부른다.
 */
export function useSidePane({ toggleRef, queueHeadingRef, mineHeadingRef, open, setOpen, onUnauthorized, say, onFirstLoad, initialSection = "queue" }: Options) {
  const router = useRouter();
  // 창 맨 위 [대기열 | 내 담당] 토글에서 보이는 쪽. 한 번에 한 목록만 그린다.
  const [section, setSection] = useState<PaneSection>(initialSection);
  const [data, setData] = useState<QueueResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const wantFocus = useRef<PaneSection | null>(null);
  const handlers = useRef({ onUnauthorized, say, onFirstLoad, setOpen });

  useEffect(() => {
    handlers.current = { onUnauthorized, say, onFirstLoad, setOpen };
  }, [onUnauthorized, say, onFirstLoad, setOpen]);

  /**
   * 목록을 다시 읽는다. 성공하면 true. markNew가 false면(첫 읽기·다시 채운 직후) '새 요청'을 붙이지 않는다.
   * 실패하면 상태 줄에 안내한다.
   */
  const refresh = useCallback(async (markNew: boolean): Promise<boolean> => {
    const result = await fetchQueue();
    if (result.kind === "unauthorized") {
      handlers.current.onUnauthorized();
      return false;
    }
    if (result.kind === "failed") {
      setFailed(true);
      handlers.current.say(result.message);
      return false;
    }
    const ids = result.data.waiting.map((item) => item.requestId);
    setNewIds(markNew ? newRequestIds(readSeen(), ids) : new Set());
    saveSeen(ids);
    setFailed(false);
    setData(result.data);
    setLoadedAt(Date.now());
    return true;
  }, []);

  // 화면을 열 때 한 번.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchQueue();
      if (cancelled) return;
      if (result.kind === "unauthorized") {
        handlers.current.onUnauthorized();
        return;
      }
      if (result.kind === "failed") {
        setFailed(true);
        handlers.current.say(result.message);
        return;
      }
      saveSeen(result.data.waiting.map((item) => item.requestId));
      setData(result.data);
      setLoadedAt(Date.now());
      handlers.current.onFirstLoad?.(result.data, (value) => handlers.current.setOpen(value, false));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const placeFocus = useCallback(() => {
    const section = wantFocus.current;
    if (!section) return;
    wantFocus.current = null;
    (section === "queue" ? queueHeadingRef : mineHeadingRef).current?.focus();
  }, [queueHeadingRef, mineHeadingRef]);

  /** 창을 열고 그 쪽 토글을 고른 뒤 그 제목으로 초점을 옮긴다(다음 그림에서). */
  const focusSection = useCallback(
    (next: PaneSection) => {
      wantFocus.current = next;
      setSection(next);
      if (!open) setOpen(true, false);
    },
    [open, setOpen],
  );

  // 열렸거나 고른 쪽이 바뀌어 제목이 그려진 뒤 초점을 옮긴다.
  useEffect(() => {
    if (open) placeFocus();
  }, [open, section, placeFocus]);

  /**
   * 창을 닫고 초점을 위 막대 여닫기 버튼으로 돌려준다. 그 버튼은 창이 열려 있는 동안 숨어 있어서(창 안 [닫기]가 대신한다),
   * 닫힌 그림이 그려진 다음 차례에 옮긴다.
   */
  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => toggleRef.current?.focus(), 0);
  }, [setOpen, toggleRef]);

  // 겹친 창은 Esc로 닫고 초점을 연 버튼으로 돌려준다.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isWideScreen()) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const locked = Boolean(data?.mine);

  /** [이 요청 맡기]. 성공하면 그 요청 화면으로 간다. 늦었거나 이미 맡은 게 있으면 안내하고 목록을 다시 읽는다. */
  const claim = useCallback(
    async (requestId: string) => {
      if (claimingId) return;
      if (locked) {
        say(VOLUNTEER_MESSAGES.lockedByMine);
        return;
      }
      setClaimingId(requestId);
      say("");
      const outcome = await claimRequest(requestId);
      if (outcome.kind === "claimed") {
        // 좁은 화면의 겹친 창은 요청을 맡으면 접는다(다음 화면이 창에 덮인 채 시작하지 않게). 넓은 화면은 기억한 대로 둔다.
        if (!isWideScreen()) handlers.current.setOpen(false);
        router.push(`/volunteer/requests/${outcome.requestId}`);
        return;
      }
      if (outcome.kind === "unauthorized") {
        handlers.current.onUnauthorized();
        return;
      }
      const text =
        outcome.kind === "taken"
          ? VOLUNTEER_MESSAGES.takenByOther
          : outcome.kind === "busy"
            ? VOLUNTEER_MESSAGES.lockedByMine
            : outcome.kind === "not_found"
              ? VOLUNTEER_MESSAGES.notFound
              : outcome.message;
      // 안내는 목록을 다시 읽은 뒤에 남긴다.
      if (outcome.kind !== "failed") await refresh(true);
      say(text);
      setClaimingId(null);
    },
    [claimingId, locked, say, router, refresh],
  );

  /** 완료 항목을 눌러 그 요청 화면으로 갈 때. 좁은 화면의 겹친 창은 접는다(다음 화면이 창에 덮인 채 시작하지 않게). 넓은 화면은 기억한 대로 둔다. */
  const openSent = useCallback(() => {
    if (!isWideScreen()) handlers.current.setOpen(false);
  }, []);

  return {
    data,
    failed,
    loadedAt,
    newIds,
    locked,
    claimingId,
    refresh,
    claim,
    openSent,
    focusSection,
    section,
    setSection,
    close,
  };
}

export type SidePane = ReturnType<typeof useSidePane>;
