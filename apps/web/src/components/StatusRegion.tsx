/** VoiceOver가 읽는 상태 안내. 내용이 바뀌어야 읽으므로 빈 상태로도 항상 둔다. */
export function StatusRegion({ message }: { message: string }) {
  return (
    <p role="status" className="status-region">
      {message}
    </p>
  );
}
