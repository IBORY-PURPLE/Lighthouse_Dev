// 본문을 읽으면서 크기를 끊는다. 크기를 밝히지 않은 본문(스트림)도 상한을 넘기 전에 멈춘다. 넘으면 null, 본문이 없으면 "".
export async function readLimitedText(
  request: { body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<string | null> {
  const bytes = await readLimitedBytes(request, maxBytes);
  return bytes === null ? null : bytes.toString("utf8");
}

export async function readLimitedBytes(
  request: { body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(pieces);
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    pieces.push(value);
  }
}
