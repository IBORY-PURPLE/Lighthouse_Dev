import "server-only";
import { RESEARCH_LIMITS, type ResearchRequestBody } from "./research";
import { isUuid } from "./volunteerApi";

// 리서치 요청 본문 검사. 라우트가 쓴다. 사진 본문 한도는 옛 글자 읽기 라우트와 같은 1.5MB다.

const MAX_IMAGE_BYTES = RESEARCH_LIMITS.imageMaxBytes;
/** base64는 4/3배로 커진다. 나머지 칸 몫을 조금 더한다. */
export const MAX_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

export type RequestCheck =
  | { ok: true; body: ResearchRequestBody }
  | { ok: false; status: 400 | 413 | 415; error: "invalid_request" | "too_long" | "image_too_large" | "bad_image_format" };

const invalid = { ok: false, status: 400, error: "invalid_request" } as const;
const tooLong = { ok: false, status: 400, error: "too_long" } as const;

const textLength = (value: string) => [...value].length;

export function decodedBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** 파일 앞 바이트 서명. JPEG는 FF D8 FF, PNG는 89 50 4E 47 0D 0A 1A 0A로 시작한다. */
const IMAGE_SIGNATURES: Readonly<Record<"jpeg" | "png", readonly number[]>> = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** 선언한 형식(data:image/jpeg|png)과 실제 바이트 서명이 맞는지 본다. 앞 12바이트(base64 16자)만 푼다. */
export function matchesImageSignature(dataUrl: string): boolean {
  const kind = IMAGE_DATA_URL.exec(dataUrl)?.[1] as "jpeg" | "png" | undefined;
  if (!kind) return false;
  const start = dataUrl.indexOf(",") + 1;
  const head = Buffer.from(dataUrl.slice(start, start + 16), "base64");
  const signature = IMAGE_SIGNATURES[kind];
  return head.length >= signature.length && signature.every((byte, index) => head[index] === byte);
}

type Fail = Exclude<RequestCheck, { ok: true }>;

function readText(value: unknown, max: number, required: boolean): string | Fail {
  if (typeof value !== "string") return invalid;
  const text = value.trim();
  if (textLength(text) > max) return tooLong;
  if (required && text === "") return invalid;
  return text;
}

function readAlts(value: unknown, min: number): string[] | Fail {
  if (!Array.isArray(value)) return invalid;
  if (value.length > RESEARCH_LIMITS.maxAlts) return tooLong;
  const names: string[] = [];
  for (const entry of value) {
    const name = readText(entry, RESEARCH_LIMITS.nameMax, true);
    if (typeof name !== "string") return name;
    names.push(name);
  }
  return names.length < min ? invalid : names;
}

const isFail = (value: unknown): value is Fail => typeof value === "object" && value !== null && !Array.isArray(value);

/** 요청 본문 `{requestId, kind, …}`를 검사해 다듬은 값(앞뒤 공백 제거)으로 돌려준다. */
export function parseResearchRequest(input: unknown): RequestCheck {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid;
  const raw = input as Record<string, unknown>;
  const { requestId, kind } = raw;
  if (typeof requestId !== "string" || !isUuid(requestId)) return invalid;
  const id = requestId.toLowerCase();

  const modelOf = () => readText(raw.model, RESEARCH_LIMITS.nameMax, true);

  switch (kind) {
    case "model":
      return { ok: true, body: { requestId: id, kind } };
    case "pros":
    case "alts":
    case "benefits":
    case "refs": {
      const model = modelOf();
      if (isFail(model)) return model;
      return { ok: true, body: { requestId: id, kind, model } };
    }
    case "altReason": {
      const model = modelOf();
      if (isFail(model)) return model;
      const alts = readAlts(raw.alts, 1);
      if (isFail(alts)) return alts;
      return { ok: true, body: { requestId: id, kind, model, alts } };
    }
    case "summary": {
      const model = modelOf();
      if (isFail(model)) return model;
      const alts = readAlts(raw.alts, 0);
      if (isFail(alts)) return alts;
      const answers: string[] = [];
      for (const key of ["pros", "altReason", "benefits", "refs"] as const) {
        const text = readText(raw[key], RESEARCH_LIMITS.answerInputMax, false);
        if (isFail(text)) return text;
        answers.push(text);
      }
      const [pros, altReason, benefits, refs] = answers;
      return { ok: true, body: { requestId: id, kind, model, pros, alts, altReason, benefits, refs } };
    }
    case "photo": {
      const model = modelOf();
      if (isFail(model)) return model;
      const { photoKind, image } = raw;
      if ((photoKind !== "proof" && photoKind !== "detail") || typeof image !== "string") return invalid;
      if (!IMAGE_DATA_URL.test(image)) return { ok: false, status: 415, error: "bad_image_format" };
      if (!BASE64_BODY.test(image.slice(image.indexOf(",") + 1))) return invalid;
      if (decodedBytes(image) > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: "image_too_large" };
      if (!matchesImageSignature(image)) return { ok: false, status: 415, error: "bad_image_format" };
      return { ok: true, body: { requestId: id, kind, model, photoKind, image } };
    }
    default:
      return invalid;
  }
}
