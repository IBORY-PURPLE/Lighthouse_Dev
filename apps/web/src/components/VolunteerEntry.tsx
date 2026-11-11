"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { StatusRegion } from "@/components/StatusRegion";
import { enterVolunteer, readNickname, saveNickname } from "@/lib/volunteerClient";
import { VOLUNTEER_MESSAGES } from "@/lib/volunteerView";

interface VolunteerEntryProps {
  /** 이 기기에 입장 코드 쿠키(lh_access)가 없으면 true. false면 별명만 묻는다. */
  needsCode: boolean;
  onEntered: () => void;
}

/** 화면 1: 처음 입장. 입장 코드(필요할 때)와 별명으로 이 기기를 봉사자로 등록한다. */
export function VolunteerEntry({ needsCode, onEntered }: VolunteerEntryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState(readNickname);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 낭독이 화면 이름부터 시작하게 제목에 초점을 둔다. 그 사이 이용자가 이미 칸을 눌렀으면 초점을 빼앗지 않는다.
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = nickname.trim();
    const length = [...trimmed].length;
    if (length < 1 || length > 12) {
      setMessage(VOLUNTEER_MESSAGES.invalidNickname);
      return;
    }
    setBusy(true);
    setMessage("");
    const outcome = await enterVolunteer(needsCode ? code.trim() : null, trimmed);
    if (outcome.kind === "ok") {
      saveNickname(trimmed);
      onEntered();
      return;
    }
    setBusy(false);
    setMessage(outcome.message);
  };

  return (
    <div className="vol-root">
      <main className="vol-page vol-page--plain">
        <form className="vol-entry" onSubmit={handleSubmit} noValidate>
          <h1 ref={headingRef} tabIndex={-1}>
            봉사자 입장
          </h1>
          <p className="vol-lead">처음 한 번만 입력합니다. 이 기기에 기억됩니다.</p>
          {needsCode && (
            <>
              <label className="vol-label" htmlFor="vol-code">
                입장 코드
              </label>
              <input
                id="vol-code"
                className="vol-input"
                // 시연 화면(프로젝터)에 입장 코드가 그대로 드러나지 않게 가린다.
                type="password"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="운영자에게 받은 코드"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </>
          )}
          <label className="vol-label" htmlFor="vol-nickname">
            별명
          </label>
          <input
            id="vol-nickname"
            className="vol-input"
            type="text"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="다른 봉사자에게 보일 이름 (예: 민지)"
            autoComplete="off"
          />
          <StatusRegion message={message} />
          <button
            type="submit"
            className="vol-btn vol-btn--block"
            aria-disabled={busy ? true : undefined}
          >
            시작하기
          </button>
          <p className="vol-foot">
            계정과 비밀번호는 없습니다. 입장 코드는 운영자에게 받고, 기기를 바꾸면 다시 넣습니다.
          </p>
        </form>
      </main>
    </div>
  );
}
