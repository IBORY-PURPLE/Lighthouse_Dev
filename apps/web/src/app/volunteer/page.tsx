"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { StatusRegion } from "@/components/StatusRegion";
import { VolunteerQueue } from "@/components/VolunteerQueue";
import { enterVolunteer, fetchMe } from "@/lib/volunteerClient";
import { VOLUNTEER_MESSAGES } from "@/lib/volunteerView";

type Gate = { kind: "checking" } | { kind: "failed" } | { kind: "ready" };

/** 이 기기가 아직 기기 쿠키(lh_vol)를 받지 않았으면 스스로 입장 호출을 하고 요청 목록을 보인다. 입력 화면은 없다. */
async function resolveGate(): Promise<Gate> {
  const me = await fetchMe();
  if (me.kind !== "ok") return { kind: "failed" };
  if (me.data.entered) return { kind: "ready" };
  const entered = await enterVolunteer();
  return entered.kind === "ok" ? { kind: "ready" } : { kind: "failed" };
}

function VolunteerHome() {
  const [gate, setGate] = useState<Gate>({ kind: "checking" });

  const check = useCallback(async () => {
    setGate(await resolveGate());
  }, []);

  useEffect(() => {
    // 응답이 오면 상태를 바꾼다(effect 본문에서 바로 바꾸지 않는다).
    let cancelled = false;
    void resolveGate().then((next) => {
      if (!cancelled) setGate(next);
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
  // 쿠키가 없어졌거나 틀리면 다시 입장을 거친다.
  return <VolunteerQueue onUnauthorized={() => void check()} />;
}

export default function VolunteerPage() {
  return (
    <Suspense fallback={null}>
      <VolunteerHome />
    </Suspense>
  );
}
