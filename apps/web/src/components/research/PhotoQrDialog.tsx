"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { postPhotoLink, type PhotoLinkView } from "@/lib/researchClient";

const PHONE_PATH = "/volunteer/photo";
/**
 * QR에 넣을 주소의 앞부분. 배포에서는 지금 화면 주소 그대로다.
 * 로컬 개발에서 노트북이 localhost로 열려 있으면 휴대폰이 그 주소를 못 여므로, 같은 와이파이 주소(예: http://192.168.0.2:3200)를
 * NEXT_PUBLIC_PHONE_ORIGIN으로 넘긴다.
 */
function phoneOrigin(): string {
  return process.env.NEXT_PUBLIC_PHONE_ORIGIN || window.location.origin;
}

/** 남은 시간을 "9:41"로. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface Issued {
  url: string;
  qr: string;
  expiresAt: number;
}

const FAIL_TEXT: Record<string, string> = {
  photos_full: "사진은 3장까지 올릴 수 있어서 새 링크를 만들지 않았어요.",
  photo_not_needed: "리서치만 하는 요청이라 사진이 필요 없어요.",
  rate_limited: "잠시 뒤에 다시 만들어 주세요.",
};

/**
 * 휴대폰으로 사진 찍기 창(QR). 열리면 새 링크를 만들고(10분, 한 번만 쓸 수 있다) QR로 보여 준다.
 * 휴대폰이 연결되면 글로 알린다. QR이 안 읽히면 같은 링크를 글로 연다. 닫기·Esc는 호출한 곳으로 초점을 돌려준다(부모가 처리).
 * 링크 상태(waiting·connected)는 부모가 서버를 다시 읽어 `link`로 넘긴다.
 */
export function PhotoQrDialog({
  requestId,
  sessionId,
  link,
  onIssued,
  onClose,
  onUnauthorized,
  settled,
}: {
  requestId: string;
  sessionId: string;
  link: PhotoLinkView | undefined;
  /** 새 링크가 만들어졌다(부모가 상태를 곧바로 waiting으로 바꾼다). */
  onIssued: (expiresAt: string) => void;
  onClose: () => void;
  onUnauthorized: () => void;
  /** 앞서 닫으면서 보낸 링크 끊기(DELETE)가 끝나길 기다린다. 끝나기 전에 새 링크를 만들면 늦게 닿은 DELETE가 새 링크를 끊는다. */
  settled?: () => Promise<unknown>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const alive = useRef(true);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const issue = useCallback(async () => {
    setBusy(true);
    setFailure("");
    await settled?.();
    if (!alive.current) return;
    const outcome = await postPhotoLink(requestId, { sessionId });
    if (!alive.current) return;
    if (outcome.kind === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (outcome.kind !== "ok") {
      setBusy(false);
      setIssued(null);
      setFailure(
        outcome.kind === "failed"
          ? (FAIL_TEXT[outcome.error] ?? "링크를 만들지 못했어요. 새로 만들기를 눌러 주세요.")
          : "링크를 만들지 못했어요. 새로 만들기를 눌러 주세요.",
      );
      return;
    }
    const url = `${phoneOrigin()}${PHONE_PATH}#t=${outcome.data.token}`;
    try {
      const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 });
      if (!alive.current) return;
      setIssued({ url, qr, expiresAt: Date.parse(outcome.data.expiresAt) });
      onIssued(outcome.data.expiresAt);
    } catch {
      if (alive.current) setFailure("QR을 그리지 못했어요. 새로 만들기를 눌러 주세요.");
    }
    if (alive.current) setBusy(false);
  }, [requestId, sessionId, onIssued, onUnauthorized, settled]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void issue();
  }, [issue]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  const connected = link?.state === "connected";
  const endsAt = connected && link?.expiresAt ? Date.parse(link.expiresAt) : (issued?.expiresAt ?? 0);
  const left = issued || connected ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  const expired = Boolean(issued) && !connected && (link?.state === "expired" || left === 0);

  let message = "휴대폰 카메라로 QR을 읽고, 열리는 화면에서 사진을 올려 주세요.";
  if (connected) message = "휴대폰이 연결됐어요. 휴대폰에서 사진을 찍거나 골라 올려 주세요.";
  else if (expired) message = "시간이 지났어요. 새로 만들기를 눌러 주세요.";
  else if (!issued && !failure) message = "링크를 만드는 중이에요.";

  return (
    <div
      ref={rootRef}
      className="vc-attach vc-qr"
      role="dialog"
      aria-labelledby="vc-qr-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <h2 id="vc-qr-title" className="vc-qr-title">
        휴대폰으로 사진 찍기
      </h2>
      <div className="vc-qr-body">
        <div className={`vc-qr-code${expired ? " vc-qr-code--old" : ""}`}>
          {issued ? (
            // data URL의 QR 그림이다. next/image로 줄일 것이 없다.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={issued.qr} width={240} height={240} alt="휴대폰 카메라로 읽는 QR 코드" />
          ) : (
            <div className="vc-qr-blank" aria-hidden="true" />
          )}
        </div>
        <p role="status" className="vc-qr-note">
          {failure || message}
        </p>
        {issued && (
          <p className="vc-qr-time">
            {connected ? "연결 유지 시간" : "링크 남은 시간"} <strong>{clock(left)}</strong>
          </p>
        )}
        {issued && (
          <details className="vc-qr-fallback">
            <summary>QR이 안 읽히나요?</summary>
            <label htmlFor="vc-qr-link" className="vc-drop-note">
              휴대폰 브라우저에서 이 링크를 열어 주세요. 한 번만 열 수 있어요.
            </label>
            <input id="vc-qr-link" className="vc-qr-link" readOnly value={issued.url} onFocus={(event) => event.target.select()} />
          </details>
        )}
      </div>
      <div className="vc-qr-actions">
        <button type="button" className="vc-btn" disabled={busy} onClick={() => void issue()}>
          새로 만들기
        </button>
        <button type="button" className="vc-btn vc-btn--ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
