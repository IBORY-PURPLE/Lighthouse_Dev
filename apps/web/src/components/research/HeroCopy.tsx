import { StatusPill } from "./PurchaseBadge";

/**
 * 히어로(가운데 큰 제목) 문구. 봉사자 첫 화면과 요청을 맡은 직후 리서치 화면이 같이 쓴다.
 * hint는 구매 여부를 고른 뒤 이용자 요청 카드가 나온다는 안내(이용자 답이 있을 때만).
 * subject가 있으면 "{제품} 구매 경험 리서치 어시스턴트", 없으면(요청을 맡기 전) "구매 경험 리서치 어시스턴트".
 */
export function HeroCopy({ subject, pill, hint }: { subject?: string; pill?: string; hint?: string }) {
  return (
    <div className="vc-hero-copy">
      {pill && <StatusPill text={pill} />}
      <h2 className="vc-hero-title">
        {subject ? `${subject} ` : ""}구매 경험{" "}
        <br />
        리서치 어시스턴트
      </h2>
      <p className="vc-hero-sub">구매했던 경험을 시각장애인 유저에게 공유해 봐요.</p>
      {hint && (
        <p className="vc-hero-hint" data-testid="hero-brief-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
