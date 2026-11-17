import Link from "next/link";
import type { Ref } from "react";
import type { SidePane as SidePaneState } from "@/lib/useSidePane";
import { quoteOf, sentDayLabel, VOLUNTEER_MESSAGES, waitLabel } from "@/lib/volunteerView";

/** 서울 시각 "HH:MM". */
function clock(time: number): string {
  return new Date(time).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 왼쪽 창. 위쪽은 "대기열"(기준 시각, [새로 보기], 대기 요청 카드), 아래쪽은 "내 담당"(진행 중 1건과 이 기기에서 보낸 요청).
 * 데이터는 /api/volunteer/queue의 waiting·mine·sent다. 닫히면 inert라 초점이 들어가지 않고 보이지도 않는다.
 * 1180px 이상은 대화 옆에 붙고 그 아래는 대화 위에 겹친다.
 */
export function SidePane({
  id,
  open,
  pane,
  currentId,
  queueHeadingRef,
  mineHeadingRef,
}: {
  id: string;
  open: boolean;
  pane: SidePaneState;
  queueHeadingRef: Ref<HTMLHeadingElement>;
  mineHeadingRef: Ref<HTMLHeadingElement>;
  /** 지금 열어 둔 요청 id. 진행 중 요청이면 [이어서 하기]에, 보낸 요청이면 그 완료 항목에 aria-current="page". */
  currentId?: string;
}) {
  const { data, failed, loadedAt, newIds, locked, claimingId } = pane;
  const waiting = data?.waiting ?? [];
  const mine = data?.mine ?? null;
  const sent = data?.sent ?? [];
  const busy = claimingId !== null;

  return (
    <aside id={id} className={`vc-mine${open ? " is-open" : ""}`} aria-label="대기열과 내 담당" inert={!open}>
      <section className="vc-mine-sec" aria-labelledby={`${id}-queue`}>
        <div className="vc-mine-headrow">
          <h2 id={`${id}-queue`} ref={queueHeadingRef} tabIndex={-1} className="vc-mine-title">
            대기열
          </h2>
          <button
            type="button"
            className="vc-btn vc-btn--small"
            aria-disabled={!data ? true : undefined}
            onClick={() => {
              if (data) void pane.refresh(true);
            }}
          >
            새로 보기
          </button>
        </div>
        {!data ? (
          <p className="vc-mine-empty">{failed ? "불러오지 못했어요." : "불러오는 중이에요."}</p>
        ) : (
          <>
            <p className="vc-mine-asof" data-testid="queue-asof">
              {clock(loadedAt)} 기준 · 대기 {waiting.length}건 · 오래 기다린 순
            </p>
            {data.notice && <p className="vc-mine-empty">{data.notice}</p>}
            {waiting.length === 0 ? (
              <p className="vc-mine-empty">지금 대기 중인 요청이 없어요.</p>
            ) : (
              <ul className="vc-mine-list">
                {waiting.map((item) => (
                  <li key={item.requestId} className="vc-mine-card" data-testid="queue-card">
                    <div className="vc-mine-head">
                      <span className="vh-chips">
                        <span className="vh-chip">대기</span>
                        {newIds.has(item.requestId) && <span className="vh-chip vh-chip--new">새 요청</span>}
                      </span>
                      <span className="vc-mine-meta">{waitLabel(item.createdAt, loadedAt)}</span>
                    </div>
                    <p className="vc-mine-quote">{quoteOf(item.product, item.budget)}</p>
                    <button
                      type="button"
                      className={`vc-btn vc-btn--small${locked ? "" : " vc-btn--ink"}`}
                      aria-disabled={locked || busy ? true : undefined}
                      onClick={() => void pane.claim(item.requestId)}
                    >
                      {locked ? VOLUNTEER_MESSAGES.lockedByMine : "이 요청 맡기"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="vc-mine-sec" aria-labelledby={`${id}-mine`}>
        <h2 id={`${id}-mine`} ref={mineHeadingRef} tabIndex={-1} className="vc-mine-title">
          내 담당
        </h2>
        {!data ? null : (
          <>
            <h3 className="vc-mine-sub">진행 중 {mine ? 1 : 0}</h3>
            {mine ? (
              <div className="vc-mine-card" data-testid="mine-current">
                <div className="vc-mine-head">
                  <span className="vh-chip">진행</span>
                  <span className="vc-mine-meta">내가 맡음</span>
                </div>
                <p className="vc-mine-quote">{quoteOf(mine.product, mine.budget)}</p>
                <Link
                  href={`/volunteer/requests/${mine.requestId}`}
                  className="vc-btn vc-btn--small"
                  aria-current={currentId === mine.requestId ? "page" : undefined}
                >
                  이어서 하기
                </Link>
              </div>
            ) : (
              <p className="vc-mine-empty">맡은 요청이 없어요.</p>
            )}
            <h3 className="vc-mine-sub">이 기기에서 보낸 요청</h3>
            {sent.length === 0 ? (
              <p className="vc-mine-empty">아직 보낸 요청이 없어요.</p>
            ) : (
              <ul className="vc-mine-list">
                {sent.map((item) => (
                  <li key={item.requestId}>
                    <Link
                      href={`/volunteer/requests/${item.requestId}`}
                      className="vc-mine-card vc-mine-card--link"
                      data-testid="mine-sent"
                      onClick={pane.openSent}
                      aria-current={currentId === item.requestId ? "page" : undefined}
                    >
                      <span className="vc-mine-head">
                        <span className="vh-chip">완료</span>
                        <span className="vc-mine-meta">{sentDayLabel(item.sentAt, loadedAt)}</span>
                      </span>
                      <span className="vc-mine-quote">{quoteOf(item.product, item.budget)}</span>
                      <span className="vc-mine-meta">전달 완료</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="vc-mine-foot">이 기기에서 보낸 요청만 보여요.</p>
          </>
        )}
      </section>
    </aside>
  );
}
