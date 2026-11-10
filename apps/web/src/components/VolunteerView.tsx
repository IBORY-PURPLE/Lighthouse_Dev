"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { StatusRegion } from "@/components/StatusRegion";
import { VolunteerChat } from "@/components/VolunteerChat";
import {
  parseStoredMatch,
  readStoredMatch,
  requestLabel,
} from "@/lib/matchHandoff";
import {
  createInitialModel,
  PRIMARY_INPUT,
  speechInputReducer,
} from "@/lib/speech";

/**
 * 낭독 영역은 빈 채로 먼저 그려져 있어야 VoiceOver가 변화를 읽는다.
 * 같은 탭 이동으로 열릴 때 내용이 처음부터 있으면 읽지 않을 수 있어 조금 뒤에 채운다.
 */
const ANNOUNCE_DELAY_MS = 100;

// sessionStorage는 열려 있는 동안 이 탭 안에서 바뀌지 않으므로 구독할 변화가 없다.
const subscribeNothing = () => () => {};
const notOnServer = () => undefined;

export function VolunteerView() {
  const stored = useSyncExternalStore(
    subscribeNothing,
    readStoredMatch,
    notOnServer,
  );
  const match = useMemo(() => parseStoredMatch(stored), [stored]);
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announced, setAnnounced] = useState(false);
  const [initialChatModel] = useState(() =>
    createInitialModel(PRIMARY_INPUT),
  );
  const [chatModel, chatDispatch] = useReducer(
    speechInputReducer,
    initialChatModel,
  );

  useEffect(() => {
    headingRef.current?.focus();
    const timer = setTimeout(() => setAnnounced(true), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const hydrated = stored !== undefined;
  const arrivalMessage = !announced
    ? ""
    : match
      ? `시연: 봉사자 화면으로 바뀌었습니다. 이용자 요청: ${requestLabel(match.request)}.`
      : "매칭 정보가 없습니다.";
  // 낭독 영역은 화면에 하나만 둔다. 입력을 건드린 뒤에는 도착 안내로 돌아가지 않는다.
  // 듣기 전에 일부러 비운 영역에 도착 안내가 다시 나오면 낭독이 마이크에 섞인다.
  const message =
    chatModel === initialChatModel ? arrivalMessage : chatModel.status;

  // 쿠키 삭제가 실패해도 새로 읽으면 서버가 로그인 여부를 다시 판단한다.
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 네트워크 오류여도 새로 읽어 로그인 상태를 확인한다.
    }
    router.refresh();
    setLoggingOut(false);
  };

  return (
    <main className="volunteer-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        봉사자 화면(시연)
      </h1>
      <StatusRegion message={message} />
      {match && (
        <>
          <dl className="match-summary">
            <dt>이용자 요청</dt>
            <dd>{requestLabel(match.request)}</dd>
            <dt>이용자가 한 말</dt>
            <dd>{match.request.raw}</dd>
            <dt>연결된 봉사자</dt>
            <dd>{match.volunteer.displayName}</dd>
          </dl>
          <VolunteerChat
            match={match}
            model={chatModel}
            dispatch={chatDispatch}
          />
        </>
      )}
      {hydrated && !match && <Link href="/">이용자 화면으로 돌아가기</Link>}
      <button
        type="button"
        className="big-button big-button--secondary"
        aria-disabled={loggingOut ? true : undefined}
        onClick={handleLogout}
      >
        로그아웃
      </button>
    </main>
  );
}
