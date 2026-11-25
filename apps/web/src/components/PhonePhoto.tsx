"use client";

import { useEffect, useRef, useState } from "react";
import { shrinkPhoto } from "@/lib/researchPhoto";

// 휴대폰 사진 페이지(design.md 3.3, 6.7). 노트북의 QR 링크(/volunteer/photo#t=토큰)로 열린다.
// 토큰은 주소의 # 뒤에 있어 서버·로그·Referer로 가지 않는다. 읽자마자 메모리로 옮기고 주소에서 지운다(새로 고치면 다시 열 수 없다).
// 링크가 있으면 그 링크가 우선이고(앞서 연결된 열쇠가 다른 요청의 것일 수 있다), 링크 없이 열면 GET /api/volunteer/photo로 연결된 기기인지 본다.
// 연결돼 있거나 링크가 있으면 [사진 찍기·고르기] 하나만 보인다.
// 링크는 사진을 고른 뒤에야 쓴다(redeem). 한 번만 쓸 수 있는 링크를 눌러 보기만 한 사람이 날리지 않게 한다.

type Phase = "checking" | "ready" | "no-link" | "gone" | "failed";

const TOKEN = /^#t=([A-Za-z0-9_-]{43})$/;

const TEXT = {
  needLink: "노트북 화면의 QR을 휴대폰 카메라로 읽어 이 페이지를 열어 주세요.",
  gone: "링크의 시간이 지났거나 이미 썼어요. 노트북에서 새로 만들기를 눌러 새 QR을 읽어 주세요.",
  failed: "연결하지 못했어요. 잠시 뒤에 다시 해 주세요.",
  read: "사진을 읽지 못했어요. 다른 사진을 골라 주세요.",
  tooLarge: "사진이 너무 커요. 다른 사진을 골라 주세요.",
  format: "이 사진 형식은 받을 수 없어요. 사진을 다시 찍어 주세요.",
  full: "사진은 3장까지 올릴 수 있어요. 노트북 화면을 확인해 주세요.",
  notNeeded: "이 요청은 사진이 필요 없어요. 노트북 화면을 확인해 주세요.",
  busy: "잠시 뒤에 다시 올려 주세요.",
  done: "사진을 올렸어요. 노트북 화면에서 확인해 주세요.",
};

async function call(path: string, init?: RequestInit): Promise<{ status: number; error: string }> {
  try {
    const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
    let error = "";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
        error = (body as { error: string }).error;
      }
    } catch {
      // 본문이 없거나 JSON이 아니다.
    }
    return { status: response.status, error };
  } catch {
    return { status: 0, error: "network" };
  }
}

export function PhonePhoto() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(0);
  const [note, setNote] = useState("");
  const token = useRef<string | null>(null);
  const granted = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    /** 주소의 #t=를 메모리로 옮기고 주소에서 지운다(주소창·기록·공유에 토큰이 남지 않게). 있으면 true. */
    const takeToken = (): boolean => {
      const match = TOKEN.exec(window.location.hash);
      if (!match) return false;
      token.current = match[1];
      granted.current = false;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setPhase("ready");
      setNote("");
      return true;
    };
    // 같은 페이지에서 다른 QR 주소만 바꿔 열어도(해시만 바뀜) 새 링크를 쓴다.
    window.addEventListener("hashchange", takeToken);
    if (!started.current) {
      started.current = true;
      // 새 링크(#t=)가 있으면 앞서 연결된 열쇠(다른 요청의 것일 수 있다)를 쓰지 않고 새 링크를 쓴다. 링크 없이 연 페이지만 열쇠를 확인한다.
      if (window.location.hash && !takeToken()) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      if (!token.current) {
        void (async () => {
          const got = await call("/api/volunteer/photo");
          if (token.current) return;
          if (got.status === 200) {
            granted.current = true;
            setPhase("ready");
          } else {
            setPhase(got.status === 0 ? "failed" : "no-link");
          }
        })();
      }
    }
    return () => window.removeEventListener("hashchange", takeToken);
  }, []);

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setNote("");
    try {
      if (!granted.current) {
        const redeemed = await call("/api/volunteer/photo/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.current }),
        });
        if (redeemed.status === 200) {
          granted.current = true;
          token.current = null;
        } else {
          token.current = null;
          setPhase(redeemed.status === 410 ? "gone" : "failed");
          return;
        }
      }
      let shrunk: Awaited<ReturnType<typeof shrinkPhoto>>;
      try {
        shrunk = await shrinkPhoto(file);
      } catch {
        setNote(TEXT.read);
        return;
      }
      const sent = await call("/api/volunteer/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: shrunk.image, thumb: shrunk.thumb }),
      });
      if (sent.status === 201) {
        setUploaded((count) => count + 1);
        setNote(TEXT.done);
      } else if (sent.status === 410) {
        granted.current = false;
        setPhase("gone");
      } else if (sent.status === 409) {
        setNote(sent.error === "photo_not_needed" ? TEXT.notNeeded : TEXT.full);
      } else if (sent.status === 413) {
        setNote(TEXT.tooLarge);
      } else if (sent.status === 415) {
        setNote(TEXT.format);
      } else if (sent.status === 429) {
        setNote(TEXT.busy);
      } else {
        setNote(TEXT.failed);
      }
    } finally {
      setBusy(false);
    }
  };

  const blocked = phase === "no-link" || phase === "gone" || phase === "failed";
  const message = phase === "no-link" ? TEXT.needLink : phase === "gone" ? TEXT.gone : phase === "failed" ? TEXT.failed : "";

  return (
    <div className="vol-chat vc-phone">
      <main className="vc-phone-main">
        <h1 className="vc-phone-title">사진 올리기</h1>
        <p className="vc-phone-lead">구매 인증에 쓸 사진을 올려 주세요. 직접 찍은 착용 사진이나 실제 가지고 있는 모습이면 돼요. 상세 페이지 캡처는 받지 않아요.</p>
        {phase === "checking" && <p className="vc-phone-note">연결을 확인하는 중이에요.</p>}
        {blocked && <p className="vc-phone-note vc-phone-note--alert">{message}</p>}
        {phase === "ready" && (
          <label className={`vc-btn vc-btn--ink vc-phone-btn${busy ? " vc-btn--off" : ""}`}>
            {uploaded > 0 ? "사진 더 올리기" : "사진 찍기·고르기"}
            <input
              type="file"
              accept="image/*"
              className="vc-file"
              disabled={busy}
              onChange={(event) => {
                const files = event.target.files;
                void onFiles(files).finally(() => {
                  event.target.value = "";
                });
              }}
            />
          </label>
        )}
        <p role="status" className="vc-phone-note">
          {busy ? "사진을 올리는 중이에요." : note}
        </p>
        <p className="vc-phone-hint">카카오톡 같은 앱 안에서 열었다면 카메라가 안 열릴 수 있어요. 그럴 때는 사파리나 크롬으로 열어 주세요.</p>
      </main>
    </div>
  );
}
