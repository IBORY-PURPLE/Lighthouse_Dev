/** 찾는 방법 카드: 검색어, 확인할 조건, 찾는 순서. 되묻는 질문에는 이것만 답한다(가격·재고 없음). */
export function GuideCard({ queries, checks, steps }: { queries: string[]; checks: string[]; steps: string[] }) {
  return (
    <div className="vc-card vc-card--guide">
      <section>
        <h3 className="vc-guide-title">검색어</h3>
        <ul className="vc-guide-list">
          {queries.map((query) => (
            <li key={query}>
              <code>{query}</code>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="vc-guide-title">확인할 조건</h3>
        <ul className="vc-guide-list">
          {checks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="vc-guide-title">찾는 순서</h3>
        <ol className="vc-guide-list">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
