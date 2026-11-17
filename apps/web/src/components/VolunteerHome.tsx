"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { SidePane } from "@/components/SidePane";
import { Composer } from "@/components/research/Composer";
import { HeroBackdrop } from "@/components/research/HeroBackdrop";
import { HeroCopy } from "@/components/research/HeroCopy";
import { resetDemoRequests, takeFlash } from "@/lib/volunteerClient";
import { filterSlash, HOME_COPY, parseHomeInput } from "@/lib/volunteerCommands";
import { SIDE_PANE_ID, useSidePane } from "@/lib/useSidePane";

interface VolunteerHomeProps {
  /** 쿠키가 없어졌거나 틀리면(401) 입장 화면으로 돌아가게 부모에게 알린다. */
  onUnauthorized: () => void;
}

/**
 * 봉사자 첫 화면(맡은 요청 없음). 리서치 화면의 히어로와 같은 레이아웃이다: 가운데 제목, 큰 입력창, 왼쪽 창.
 * 대기열과 내 담당은 왼쪽 창에 있다. 입력창은 명령만 받는다(대기열 열기, 내 담당 열기, 시연 초기화).
 * AI는 부르지 않는다(서버는 큐·맡기·초기화 호출만). 대화는 없고 아무것도 저장하지 않는다.
 */
export function VolunteerHome({ onUnauthorized }: VolunteerHomeProps) {
  const params = useSearchParams();
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [resetState, setResetState] = useState<"asking" | "busy" | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);

  const forceMine = params.get("tab") === "mine";

  // 다른 화면(내려놓기)에서 돌아온 안내가 있으면 상태 줄에 보이고 왼쪽 창을 연다.
  const onFirstLoad = useCallback((_data: unknown, setOpen: (open: boolean) => void) => {
    const flash = takeFlash();
    if (flash) {
      setNotice(flash);
      setOpen(true);
    }
  }, []);

  const toggleRef = useRef<HTMLButtonElement>(null);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const mineHeadingRef = useRef<HTMLHeadingElement>(null);
  const pane = useSidePane({ toggleRef, queueHeadingRef, mineHeadingRef, forceOpen: forceMine, onUnauthorized, say: setNotice, onFirstLoad });

  const confirmReset = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setResetState("busy");
    setNotice("");
    const result = await resetDemoRequests();
    if (result.kind === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (result.kind === "failed") {
      setNotice(result.message);
      setResetState("asking");
      busyRef.current = false;
      return;
    }
    setResetState(null);
    if (await pane.refresh(false)) setNotice(HOME_COPY.resetDone);
    busyRef.current = false;
  };

  const cancelReset = () => {
    setResetState(null);
    setNotice(HOME_COPY.resetCancelled);
  };

  /** 입력과 "/" 메뉴가 같이 쓴다. */
  const run = (command: "queue" | "mine" | "reset" | "unknown") => {
    if (resetState) return;
    if (command === "queue") {
      pane.focusSection("queue");
      setNotice(HOME_COPY.queueOpened);
      void pane.refresh(true);
    } else if (command === "mine") {
      pane.focusSection("mine");
      setNotice(HOME_COPY.mineOpened);
      void pane.refresh(false);
    } else if (command === "reset") {
      setNotice("");
      setResetState("asking");
      window.setTimeout(() => confirmRef.current?.focus(), 0);
    } else {
      setNotice(HOME_COPY.pick);
    }
  };

  const submit = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    run(parseHomeInput(text));
  };

  const slash = resetState ? [] : filterSlash(draft);

  return (
    <div
      className={`vol-chat vc-stage is-hero vh-home${pane.open ? " has-mine" : ""}`}
      data-testid="home-stage"
    >
      <header className="vc-topbar vh-topbar">
        <h1 className="vc-topbar-title">봉사자</h1>
        <span className="vh-spacer" />
        <button
          ref={toggleRef}
          type="button"
          className="vc-mine-toggle"
          aria-expanded={pane.open}
          aria-controls={SIDE_PANE_ID}
          onClick={pane.toggle}
        >
          대기열·내 담당
        </button>
      </header>
      <div className="vc-body">
        <HeroBackdrop variant="hero" />
        <SidePane id={SIDE_PANE_ID} pane={pane} queueHeadingRef={queueHeadingRef} mineHeadingRef={mineHeadingRef} />
        <main className="vc-main">
          <HeroCopy />
          <div className="vc-dock">
            <p role="status" className="vc-notice">
              {notice}
            </p>
            {resetState && (
              <div className="vh-confirm" role="group" aria-label="시연 초기화 확인">
                <p className="vh-confirm-text">{HOME_COPY.resetAsk}</p>
                <div className="vc-release-row">
                  <button
                    ref={confirmRef}
                    type="button"
                    className="vc-btn vc-btn--small vc-btn--ink"
                    aria-disabled={resetState === "busy" ? true : undefined}
                    onClick={() => void confirmReset()}
                  >
                    다시 채우기
                  </button>
                  <button
                    type="button"
                    className="vc-btn vc-btn--small"
                    aria-disabled={resetState === "busy" ? true : undefined}
                    onClick={() => {
                      if (resetState === "asking") cancelReset();
                    }}
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
            {slash.length > 0 && (
              <div className="vc-quick vh-slash" role="group" aria-label="명령">
                {slash.map((entry) => (
                  <button
                    key={entry.command}
                    type="button"
                    className="vc-quick-btn"
                    onClick={() => {
                      setDraft("");
                      run(entry.action);
                    }}
                  >
                    <strong>{entry.command}</strong> {entry.label}
                  </button>
                ))}
              </div>
            )}
            <Composer
              variant="hero"
              value={draft}
              placeholder={HOME_COPY.placeholder}
              attachVisible={false}
              attachOpen={false}
              onChange={setDraft}
              onSubmit={submit}
              onToggleAttach={() => undefined}
            />
            <p className="vc-hero-note">AI는 찾고 정리하는 일만 도와요. 최종 판단은 봉사자님이 해요.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
