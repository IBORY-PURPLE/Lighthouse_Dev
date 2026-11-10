"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** 서버가 응답하지 않을 때 버튼이 멈춰 있지 않게 끊는 시간. */
const LOGIN_TIMEOUT_MS = 10_000;

// 틀린 쪽(번호인지 비밀번호인지)을 밝히지 않는다.
const MESSAGE = {
  invalid: "전화번호 또는 비밀번호가 올바르지 않습니다.",
  tooMany: "로그인 시도가 너무 많습니다. 10분 뒤 다시 해 주세요.",
  unreachable: "로그인 서버에 연결하지 못했습니다. 다시 시도해 주세요.",
};

function messageForStatus(status: number): string {
  switch (status) {
    case 400:
    case 401:
      return MESSAGE.invalid;
    case 429:
      return MESSAGE.tooMany;
    default:
      return MESSAGE.unreachable;
  }
}

/** 봉사자 로그인 칸. 로그인 전에는 봉사자 화면 코드가 그려지지 않는다. */
export function VolunteerLogin() {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = sending || refreshing;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const phone = String(form.get("phone") ?? "");
    const password = String(form.get("password") ?? "");

    setSending(true);
    setError("");
    let failure = "";
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
        signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      });
      if (response.ok) {
        // 서버 컴포넌트가 쿠키를 다시 읽어 봉사자 화면으로 바꾼다.
        startRefresh(() => router.refresh());
      } else {
        failure = messageForStatus(response.status);
      }
    } catch {
      failure = MESSAGE.unreachable;
    }
    setSending(false);
    if (failure) {
      setError(failure);
      // 실패하면 비밀번호 칸만 비우고 다시 입력하게 한다.
      if (passwordRef.current) passwordRef.current.value = "";
      passwordRef.current?.focus();
    }
  };

  return (
    <main className="volunteer-screen">
      <h1 ref={headingRef} tabIndex={-1}>
        봉사자 로그인
      </h1>
      <form className="text-form" onSubmit={handleSubmit}>
        <label htmlFor="volunteer-phone">전화번호</label>
        <input
          id="volunteer-phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          required
        />
        <label htmlFor="volunteer-password">비밀번호</label>
        <input
          ref={passwordRef}
          id="volunteer-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="big-button"
          aria-disabled={busy ? true : undefined}
        >
          로그인
        </button>
      </form>
    </main>
  );
}
