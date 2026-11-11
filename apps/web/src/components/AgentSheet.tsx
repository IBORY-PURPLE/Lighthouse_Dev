"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { StatusRegion } from "@/components/StatusRegion";
import { MAX_QUESTION_LENGTH, requestAnswer } from "@/lib/chat";
import { STATUS } from "@/lib/speech";
import type { VolunteerRequestView } from "@/lib/volunteerView";

export const AGENT_GREETING =
  "검색어, 확인할 조건, 찾는 순서를 알려 드립니다. 가격과 재고는 쇼핑몰에서 확인하세요.";

export interface AgentCandidate {
  id: string;
  name: string;
}

interface AgentSheetProps {
  /** 이 요청의 맥락. 챗봇에는 brand와 item만 보낸다(예산은 보내지 않는다). */
  request: VolunteerRequestView;
  /** 요청 화면의 후보들(블록 3이 캡처 저장 대상으로 쓴다). */
  candidates: readonly AgentCandidate[];
  /** 값이 바뀔 때마다 창을 연다(후보 칩을 눌렀을 때). candidateId는 그 후보를 가리킨다. */
  target?: { candidateId: string; nonce: number } | null;
}

interface Message {
  id: number;
  role: "volunteer" | "agent";
  text: string;
}

interface Failure {
  question: string;
  status: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 쇼핑 에이전트: 오른쪽 아래 AI 버튼과 아래에서 올라오는 창(글자 질문 → /api/chat).
 * 요청과 후보 목록만 받아 스스로 동작한다. 대화는 이 부품의 상태에만 있다
 * (창을 닫아도 남고, 부품이 사라지면 사라진다. 서버나 기기 저장소에 남기지 않는다).
 */
export function AgentSheet({ request, candidates, target }: AgentSheetProps) {
  const titleId = useId();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [aimedAt, setAimedAt] = useState<string | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const wasOpen = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  // 후보 칩에서 연 경우: 창을 열고 그 후보를 기억한다(렌더 중에 새 신호를 한 번만 받는다).
  const [seenNonce, setSeenNonce] = useState(target?.nonce);
  if (target && target.nonce !== seenNonce) {
    setSeenNonce(target.nonce);
    setAimedAt(target.candidateId);
    setOpen(true);
  }

  // 열면 제목에 초점(낭독이 창 이름부터), 닫으면 AI 버튼으로 돌아간다.
  useEffect(() => {
    if (open) titleRef.current?.focus();
    else if (wasOpen.current) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // 새 말풍선이 생기면 맨 아래로 내린다.
  const lastText = messages.at(-1)?.text;
  useEffect(() => {
    const body = bodyRef.current;
    if (open && body) body.scrollTop = body.scrollHeight;
  }, [open, messages.length, lastText]);

  const close = useCallback(() => setOpen(false), []);

  // Esc는 초점이 어디에 있든 창을 닫는다(Safari는 버튼을 눌러도 초점이 옮겨 가지 않는다).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    // 창 밖으로 초점이 나가지 않게 가둔다.
    const focusable = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter((element) => element.getAttribute("aria-disabled") !== "true");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const ask = async (text: string, retry: boolean) => {
    setBusy(true);
    setFailure(null);
    setStatus(STATUS.chatWaiting);

    const volunteerId = nextId.current++;
    const agentId = nextId.current++;
    if (!retry) {
      setMessages((current) => [...current, { id: volunteerId, role: "volunteer", text }]);
    }
    let started = false;
    const abort = new AbortController();
    abortRef.current = abort;
    const outcome = await requestAnswer(
      {
        requestId: request.requestId,
        question: text,
        context: { brand: request.brand, item: request.item ?? request.product },
      },
      (chunk) => {
        if (!started) {
          started = true;
          setMessages((current) => [...current, { id: agentId, role: "agent", text: chunk }]);
        } else {
          setMessages((current) =>
            current.map((message) =>
              message.id === agentId ? { ...message, text: message.text + chunk } : message,
            ),
          );
        }
      },
      abort,
    );
    setBusy(false);
    if (outcome.kind === "answered") {
      setStatus(STATUS.chatArrived);
      return;
    }
    // 잘린 답을 끝난 답처럼 두지 않는다. 받은 글자는 버린다.
    setMessages((current) =>
      current.filter(
        (message) =>
          message.id !== agentId && !(outcome.kind === "rejected" && message.id === volunteerId),
      ),
    );
    setStatus(outcome.status);
    if (outcome.kind === "rejected") {
      setQuestion(text);
      inputRef.current?.focus();
    } else {
      setFailure({ question: text, status: outcome.status });
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const text = question.trim();
    if (!text) {
      setStatus(STATUS.emptyQuestion);
      inputRef.current?.focus();
      return;
    }
    setQuestion("");
    void ask(text, false);
  };

  const aimedIndex = aimedAt ? candidates.findIndex((candidate) => candidate.id === aimedAt) : -1;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="vol-ai"
        aria-label="쇼핑 에이전트 열기"
        aria-haspopup="dialog"
        onClick={() => {
          setAimedAt(null);
          setOpen(true);
        }}
      >
        AI
      </button>
      {open && (
        <div className="vol-sheet-layer">
          <div className="vol-scrim" aria-hidden="true" onClick={close} />
          <div
            ref={sheetRef}
            className="vol-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={handleKeyDown}
          >
            <header className="vol-sheet-head">
              <h2 id={titleId} ref={titleRef} tabIndex={-1}>
                쇼핑 에이전트
              </h2>
              <button type="button" className="vol-sheet-close" onClick={close}>
                닫기
              </button>
            </header>
            {/* 긴 대화는 키보드로도 내려 볼 수 있게 초점을 받는다. */}
            <div
              ref={bodyRef}
              className="vol-sheet-body"
              role="region"
              aria-label="대화 내용"
              tabIndex={0}
            >
              <p className="vol-bubble vol-bubble--agent">{AGENT_GREETING}</p>
              {aimedIndex >= 0 && (
                <p className="vol-sheet-target">
                  선택한 후보: 후보 {aimedIndex + 1} · {candidates[aimedIndex].name}
                </p>
              )}
              {messages.map((message) => (
                <p
                  key={message.id}
                  className={`vol-bubble vol-bubble--${message.role === "agent" ? "agent" : "volunteer"}`}
                >
                  {message.text}
                </p>
              ))}
            </div>
            <StatusRegion message={status} />
            {failure && (
              <div className="vol-sheet-retry">
                <button
                  type="button"
                  className="vol-btn vol-btn--secondary vol-btn--small"
                  aria-disabled={busy ? true : undefined}
                  onClick={() => {
                    if (!busy) void ask(failure.question, true);
                  }}
                >
                  다시 시도
                </button>
              </div>
            )}
            <form className="vol-sheet-form" onSubmit={handleSubmit}>
              <label className="vol-sr" htmlFor={inputId}>
                찾는 방법을 글자로 물어보세요
              </label>
              <input
                ref={inputRef}
                id={inputId}
                className="vol-input"
                value={question}
                maxLength={MAX_QUESTION_LENGTH}
                placeholder="찾는 방법을 글자로 물어보세요"
                autoComplete="off"
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button
                type="submit"
                className="vol-btn"
                aria-disabled={busy ? true : undefined}
              >
                보내기
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
