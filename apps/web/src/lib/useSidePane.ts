import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { claimRequest, fetchQueue, readSeen, saveSeen, type QueueResponse } from "./volunteerClient";
import { newRequestIds, VOLUNTEER_MESSAGES } from "./volunteerView";

/** 왼쪽 창 id. 위 막대 버튼의 aria-controls가 가리킨다. */
export const SIDE_PANE_ID = "vol-mine";

const WIDE_QUERY = "(min-width: 1180px)";

/** 1180px 이상이면 창이 대화 옆에 붙고, 그 아래면 대화 위에 겹친다. */
export function isWideScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches;
}

export type PaneSection = "queue" | "mine";

interface Options {
  /** 초점을 옮길 요소들. 화면이 ref를 만들어 넘긴다(훅이 돌려주면 그리는 중에 읽는 것으로 보여 린트가 막는다). */
  toggleRef: RefObject<HTMLButtonElement | null>;
  queueHeadingRef: RefObject<HTMLHeadingElement | null>;
  mineHeadingRef: RefObject<HTMLHeadingElement | null>;
  /** 처음부터 열고 시작한다(?tab=mine). */
  forceOpen: boolean;
  /** 쿠키가 없어졌거나 틀리면(401). */
  onUnauthorized: () => void;
  /** 상태 줄에 알릴 글자. */
  say: (text: string) => void;
  /** 처음 읽기가 끝났을 때 한 번. 첫 화면이 "돌아온 안내"를 보이고 창을 여는 데 쓴다. */
  onFirstLoad?: (data: QueueResponse, setOpen: (open: boolean) => void) => void;
}

/**
 * 왼쪽 창(대기열 + 내 담당)의 열림과 데이터. 첫 화면과 리서치 화면이 같이 쓴다.
 * 열림은 넓은 화면은 열린 채, 좁은 화면은 닫힌 채 시작한다. 이 훅은 브라우저에서만 그려지는 화면(입장 확인과 요청 읽기가 끝난 뒤)이 쓴다.
 * 겹친 창은 Esc로 닫고, 초점은 연 버튼으로 돌려준다. 서버는 열 때·[새로 보기]·맡기·초기화 뒤에만 부른다.
 */
export function useSidePane({ toggleRef, queueHeadingRef, mineHeadingRef, forceOpen, onUnauthorized, say, onFirstLoad }: Options) {
  const router = useRouter();
  const [open, setOpen] = useState<boolean>(() => forceOpen || isWideScreen());
  const [data, setData] = useState<QueueResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const wantFocus = useRef<PaneSection | null>(null);
  const handlers = useRef({ onUnauthorized, say, onFirstLoad });

  useEffect(() => {
    handlers.current = { onUnauthorized, say, onFirstLoad };
  }, [onUnauthorized, say, onFirstLoad]);

  const toggle = useCallback(() => setOpen((value) => !value), []);

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
      handlers.current.onFirstLoad?.(result.data, setOpen);
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

  /** 창을 열고 그 구역 제목으로 초점을 옮긴다(닫혀 있었다면 열린 다음 그림에서). */
  const focusSection = useCallback(
    (section: PaneSection) => {
      wantFocus.current = section;
      if (open) placeFocus();
      else setOpen(true);
    },
    [open, placeFocus],
  );

  useEffect(() => {
    if (open) placeFocus();
  }, [open, placeFocus]);

  // 겹친 창은 Esc로 닫고 초점을 연 버튼으로 돌려준다.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isWideScreen()) return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, toggleRef]);

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

  return {
    open,
    setOpen,
    toggle,
    data,
    failed,
    loadedAt,
    newIds,
    locked,
    claimingId,
    refresh,
    claim,
    focusSection,
  };
}

export type SidePane = ReturnType<typeof useSidePane>;
