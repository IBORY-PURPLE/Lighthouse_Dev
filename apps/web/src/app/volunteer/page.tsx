"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { InfoSummary } from "@/components/InfoSummary";
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

export default function VolunteerPage() {
  const stored = useSyncExternalStore(
    subscribeNothing,
    readStoredMatch,
    notOnServer,
  );
  const match = useMemo(() => parseStoredMatch(stored), [stored]);
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
          <h2 className="info-summary-title">상세 이미지 요약</h2>
          <InfoSummary
            requestId={match.requestId}
            volunteerId={match.volunteer.id}
            product={match.request.raw}
          />
        </>
      )}
      {hydrated && !match && <Link href="/">이용자 화면으로 돌아가기</Link>}
    </main>
  );
}
