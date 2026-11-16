"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StatusRegion } from "@/components/StatusRegion";
import {
  claimRequest,
  fetchQueue,
  readSeen,
  resetDemoRequests,
  saveSeen,
  takeFlash,
  type QueueResponse,
} from "@/lib/volunteerClient";
import {
  newRequestIds,
  quoteOf,
  sentDayLabel,
  VOLUNTEER_MESSAGES,
  waitLabel,
} from "@/lib/volunteerView";

type Tab = "queue" | "mine";

interface VolunteerQueueProps {
  /** 쿠키가 없어졌거나 틀리면(401) 입장 화면으로 돌아가게 부모에게 알린다. */
  onUnauthorized: () => void;
}

/** 화면 2·2-2: 요청 목록(대기열 탭)과 내 담당 탭. 서버는 열 때·탭을 바꿀 때·새로고침을 누를 때만 부른다. */
export function VolunteerQueue({ onUnauthorized }: VolunteerQueueProps) {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get("tab") === "mine" ? "mine" : "queue";

  const [data, setData] = useState<QueueResponse | null>(null);
  // 대기 시간은 불러온 시각 기준으로 센다. 화면이 스스로 시간을 흘리지 않는다.
  const [loadedAt, setLoadedAt] = useState(0);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  /** 목록을 다시 불러온다. 성공하면 true. markNew가 false면(첫 불러오기·다시 채우기 직후) '새 요청'을 붙이지 않는다. */
  const load = useCallback(
    async (markNew: boolean): Promise<boolean> => {
      const result = await fetchQueue();
      if (result.kind === "unauthorized") {
        onUnauthorized();
        return false;
      }
      if (result.kind === "failed") {
        setMessage(result.message);
        return false;
      }
      const ids = result.data.waiting.map((item) => item.requestId);
      setNewIds(markNew ? newRequestIds(readSeen(), ids) : new Set());
      saveSeen(ids);
      setData(result.data);
      setLoadedAt(Date.now());
      return true;
    },
    [onUnauthorized],
  );

  // 화면을 열 때 한 번. 첫 불러오기라 '새 요청'은 붙이지 않는다. 다른 화면에서 돌아온 안내가 있으면 보인다.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await load(false);
      if (cancelled || !ok) return;
      const flash = takeFlash();
      if (flash) setMessage(flash);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const goTab = async (next: Tab) => {
    if (busy) return;
    if (next !== tab) {
      router.replace(next === "mine" ? "/volunteer?tab=mine" : "/volunteer");
    }
    setBusy(true);
    setMessage("");
    await load(true);
    setBusy(false);
  };

  const handleRefresh = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    await load(true);
    setBusy(false);
  };

  const locked = Boolean(data?.mine);

  const handleClaim = async (requestId: string) => {
    if (claimingId) return;
    if (locked) {
      setMessage(VOLUNTEER_MESSAGES.lockedByMine);
      return;
    }
    setClaimingId(requestId);
    setMessage("");
    const outcome = await claimRequest(requestId);
    if (outcome.kind === "claimed") {
      router.push(`/volunteer/requests/${outcome.requestId}`);
      return;
    }
    if (outcome.kind === "unauthorized") {
      onUnauthorized();
      return;
    }
    // 늦었거나 이미 맡은 게 있다: 안내한 뒤 목록을 다시 불러온다. 안내는 불러온 뒤에 남긴다.
    const text =
      outcome.kind === "taken"
        ? VOLUNTEER_MESSAGES.takenByOther
        : outcome.kind === "busy"
          ? VOLUNTEER_MESSAGES.lockedByMine
          : outcome.kind === "not_found"
            ? VOLUNTEER_MESSAGES.notFound
            : outcome.message;
    if (outcome.kind !== "failed") await load(true);
    setMessage(text);
    setClaimingId(null);
  };

  const handleReset = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const result = await resetDemoRequests();
    if (result.kind === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (result.kind === "failed") {
      setMessage(result.message);
      setBusy(false);
      return;
    }
    if (await load(false)) setMessage("시연용 요청을 새로 채웠어요");
    setBusy(false);
  };

  const waiting = data?.waiting ?? [];
  const mine = data?.mine ?? null;
  const sent = data?.sent ?? [];

  return (
    <div className="vol-root">
      <main className="vol-page">
        <header className="vol-topbar">
          <h1>
            {tab === "queue" ? "대기열" : "내 담당"}
          </h1>
          <button
            type="button"
            className="vol-btn vol-btn--secondary vol-btn--small"
            aria-disabled={busy ? true : undefined}
            onClick={handleRefresh}
          >
            새로고침
          </button>
        </header>
        <StatusRegion message={message} />
        {data?.notice && <p className="vol-notice">{data.notice}</p>}

        {!data ? (
          <p className="vol-empty">불러오는 중입니다.</p>
        ) : tab === "queue" ? (
          <>
            <h2>대기 중 {waiting.length}건 · 오래 기다린 순</h2>
            {waiting.length === 0 ? (
              <p className="vol-empty">지금 대기 중인 요청이 없어요.</p>
            ) : (
              <ul className="vol-list">
                {waiting.map((item) => (
                  <li key={item.requestId} className="vol-card">
                    <div className="vol-card-head">
                      <span className="vol-chips">
                        <span className="vol-chip">대기</span>
                        {newIds.has(item.requestId) && (
                          <span className="vol-chip vol-chip--outline">새 요청</span>
                        )}
                      </span>
                      <span className="vol-meta">{waitLabel(item.createdAt, loadedAt)}</span>
                    </div>
                    <p className="vol-quote">{quoteOf(item.product, item.budget)}</p>
                    <button
                      type="button"
                      className="vol-btn vol-btn--block"
                      aria-disabled={locked || claimingId !== null ? true : undefined}
                      onClick={() => handleClaim(item.requestId)}
                    >
                      {locked ? VOLUNTEER_MESSAGES.lockedByMine : "이 요청 맡기"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="vol-foot">
              오래 기다린 요청이 위에 옵니다. 새로고침을 누르면 새 요청이 나타납니다. 한 번에 1건만
              맡을 수 있습니다.
            </p>
          </>
        ) : (
          <>
            <h2>진행 중 {mine ? 1 : 0}</h2>
            {mine ? (
              <div className="vol-card">
                <div className="vol-card-head">
                  <span className="vol-chip">진행</span>
                  <span className="vol-meta vol-meta--sub">내가 맡음</span>
                </div>
                <p className="vol-quote">{quoteOf(mine.product, mine.budget)}</p>
                <Link
                  href={`/volunteer/requests/${mine.requestId}`}
                  className="vol-btn vol-btn--secondary vol-btn--block"
                >
                  이어서 하기
                </Link>
              </div>
            ) : (
              <p className="vol-empty">맡은 요청이 없어요.</p>
            )}
            <h2>이 기기에서 보낸 요청</h2>
            {sent.length === 0 ? (
              <p className="vol-empty">아직 보낸 요청이 없어요.</p>
            ) : (
              <ul className="vol-list">
                {sent.map((item) => (
                  <li key={item.requestId}>
                    <Link
                      href={`/volunteer/requests/${item.requestId}`}
                      className="vol-card vol-card-link"
                    >
                      <span className="vol-card-head">
                        <span className="vol-chip">완료</span>
                        <span className="vol-meta vol-meta--sub">
                          {sentDayLabel(item.sentAt, loadedAt)}
                        </span>
                      </span>
                      <span className="vol-quote">{quoteOf(item.product, item.budget)}</span>
                      <span className="vol-sub">전달 완료</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="vol-foot">이 기기에서 보낸 요청만 보입니다.</p>
          </>
        )}

        <section className="vol-demo" aria-label="시연 전용">
          <button
            type="button"
            className="vol-btn vol-btn--secondary vol-btn--block"
            aria-disabled={busy ? true : undefined}
            onClick={handleReset}
          >
            시연용 요청 다시 채우기
          </button>
          <p className="vol-foot">(시연 전용. 시연 요청을 지우고 새로 채웁니다)</p>
        </section>
      </main>

      <nav className="vol-tabs" aria-label="목록 전환">
        <button
          type="button"
          className="vol-tab"
          aria-current={tab === "queue" ? "page" : undefined}
          onClick={() => goTab("queue")}
        >
          대기열 {waiting.length}
        </button>
        <button
          type="button"
          className="vol-tab"
          aria-current={tab === "mine" ? "page" : undefined}
          onClick={() => goTab("mine")}
        >
          내 담당 {mine ? 1 : 0}
        </button>
      </nav>
    </div>
  );
}
