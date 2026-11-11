"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { StatusRegion } from "@/components/StatusRegion";
import { VolunteerEntry } from "@/components/VolunteerEntry";
import { VolunteerQueue } from "@/components/VolunteerQueue";
import { fetchMe, type MeResponse } from "@/lib/volunteerClient";
import { VOLUNTEER_MESSAGES } from "@/lib/volunteerView";

type Gate = { kind: "checking" } | { kind: "failed" } | { kind: "ready"; me: MeResponse };

/** 입장 전에는 입장 화면, 입장 뒤에는 요청 목록. 이 기기가 입장했는지는 서버(/me)가 알려 준다. */
function VolunteerHome() {
  const [gate, setGate] = useState<Gate>({ kind: "checking" });

  const check = useCallback(async () => {
    const result = await fetchMe();
    setGate(
      result.kind === "ok"
        ? { kind: "ready", me: result.data }
        : { kind: "failed" },
    );
  }, []);

  useEffect(() => {
    // 응답이 오면 상태를 바꾼다(effect 본문에서 바로 바꾸지 않는다).
    let cancelled = false;
    void fetchMe().then((result) => {
      if (cancelled) return;
      setGate(
        result.kind === "ok"
          ? { kind: "ready", me: result.data }
          : { kind: "failed" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.kind === "checking") {
    return (
      <div className="vol-root">
        <main className="vol-page vol-page--plain">
          <StatusRegion message="" />
          <p className="vol-empty">불러오는 중입니다.</p>
        </main>
      </div>
    );
  }
  if (gate.kind === "failed") {
    return (
      <div className="vol-root">
        <main className="vol-page vol-page--plain">
          <h1>봉사자</h1>
          <StatusRegion message={VOLUNTEER_MESSAGES.connectFailed} />
          <button type="button" className="vol-btn vol-btn--block" onClick={() => void check()}>
            다시 시도
          </button>
        </main>
      </div>
    );
  }
  if (gate.me.entered) {
    // 쿠키가 없어졌거나 틀리면 입장 상태를 다시 묻는다.
    return <VolunteerQueue onUnauthorized={() => void check()} />;
  }
  return (
    <VolunteerEntry
      needsCode={gate.me.needsCode}
      onEntered={() => setGate({ kind: "ready", me: { entered: true, needsCode: false } })}
    />
  );
}

export default function VolunteerPage() {
  return (
    <Suspense fallback={null}>
      <VolunteerHome />
    </Suspense>
  );
}
