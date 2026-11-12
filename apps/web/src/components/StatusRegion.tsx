/**
 * VoiceOver가 읽는 상태 안내. 내용이 바뀌어야 읽으므로 빈 상태로도 항상 둔다.
 * quiet이면 화면에는 보이지 않고 낭독기에만 읽힌다(화면에 이미 같은 정보가 있을 때).
 */
export function StatusRegion({ message, quiet = false }: { message: string; quiet?: boolean }) {
  return (
    <p role="status" className={`status-region${quiet ? " status-region--quiet" : ""}`}>
      {message}
    </p>
  );
}
