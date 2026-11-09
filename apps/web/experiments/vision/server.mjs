// 비전 AI 실험 서버. 제품 코드가 아니며 배포하지 않는다(apps/web/.vercelignore).
// 실행: apps/web 에서 `node experiments/vision/server.mjs` → http://127.0.0.1:4310 (VISION_LAB_PORT로 변경)
// 엔진: groq(qwen, 무료 기준선), openai(luna 계열, 유료), upstage(Document OCR, 유료).
// 키는 아래 후보 파일에서 읽고, 값은 어떤 응답·로그에도 넣지 않는다. 서버는 파일을 쓰지 않는다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Groq from "groq-sdk";
import OpenAI from "openai";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../..");

// 키 파일 위치가 확정되지 않았으므로 후보를 조건 없이 차례로 읽는다.
// loadEnvFile은 이미 있는 변수를 덮지 않으므로 앞 파일의 값이 우선한다. 값은 출력하지 않는다.
for (const envPath of [
  path.join(webRoot, ".env.local"),
  path.join(webRoot, ".env"),
  path.resolve(webRoot, "../../.env"),
]) {
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // 형식이 맞지 않으면 다음 파일을 본다.
    }
  }
}

const PORT = Number(process.env.VISION_LAB_PORT ?? 4310);
const MAX_IMAGES_PER_REQUEST = 3; // Groq qwen 제한. openai·upstage는 요청당 1장.
const MAX_BODY_BYTES = 30 * 1024 * 1024;
// 엔진당 유료 호출(조각 1장 = 호출 1회) 상한. 서버 메모리 카운터라 재시작하면 0이 된다(run.mjs가 누계를 이어 받는다).
export const MAX_PAID_CALLS_PER_ENGINE = 500;
const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";
const GROQ_TEXT_MODEL = "openai/gpt-oss-120b"; // apps/web/src/lib/llm.ts와 같은 모델
// luna 계열 중 가장 싼 모델(2026-11-10 OpenAI 가격표: gpt-6-luna 입력 $0.10/출력 $0.50, gpt-5.6-luna $0.20/$1.20 per 1M).
// /api/openai-models에서 계정에 실제로 있는지 본다. VISION_OPENAI_MODEL로 바꿀 수 있다.
const OPENAI_MODEL = process.env.VISION_OPENAI_MODEL ?? "gpt-6-luna";
const UPSTAGE_URL = "https://api.upstage.ai/v1/document-digitization";

const calls = { openai: 0, upstage: 0, groqQwen: 0, groqOss: 0 };

const PROMPTS = {
  summary: [
    "너는 쇼핑 도우미 봉사자를 돕는 어시스턴트다. 첨부된 이미지는 한 상품의 상세페이지 캡처다(여러 장이면 위에서 아래로 이어진 조각).",
    "이미지에 실제로 보이는 내용만 한국어로 아래 형식에 맞춰 적어라. 이미지에 없는 내용은 추측하지 말고 '이미지에서 못 찾음'이라고 적어라.",
    "",
    "상품명·모델명:",
    "옵션(색상·크기 등):",
    "핵심 사양(3~5개, 줄마다 하나):",
    "구성품:",
    "주의사항:",
    "이미지에 보이는 가격(실험 채점용, 보이는 그대로):",
    "읽기 어려웠던 부분:",
  ].join("\n"),
  ocr: "첨부된 이미지에 보이는 글자를 위에서 아래 순서대로 빠짐없이 그대로 받아써라. 요약하거나 고치거나 설명을 덧붙이지 말고, 읽을 수 없는 부분은 [못 읽음]으로 표시하라.",
};

const FIELD_KEYS = ["name", "options", "specs", "components", "cautions", "price"];
const SUMMARY_PROMPT = [
  "아래는 상품 상세 이미지에서 읽은 글자(OCR 원문)다. 원문에 있는 내용만으로 항목을 채워 JSON 하나만 출력하라.",
  '형식: {"fields":[{"key":"name","value":...,"evidence":...},...]}',
  "key는 순서대로 name(상품명·모델명), options(옵션), specs(핵심 사양 3~5개를 ' / '로 연결), components(구성품), cautions(주의사항), price(보이는 가격, 실험 채점용).",
  "evidence는 value의 근거가 되는 원문 구절을 글자 그대로 복사한다. 원문에 없으면 value와 evidence를 모두 null로 둔다. 추측하지 않는다.",
].join("\n");

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const KEY_NAMES = ["GROQ_API_KEY", "OPENAI_API_KEY", "UPSTAGE_API_KEY"];

// 오류 문구에 키가 섞여 나오는 경우(예: 잘못된 키 안내)를 지운다.
// 실제 키 값(전체와 앞뒤 8자 조각)을 먼저 지우고, 알려진 접두사·Bearer 형식도 지운다.
export function redact(text) {
  let out = String(text);
  for (const name of KEY_NAMES) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    const pieces = [value];
    if (value.length >= 16) pieces.push(value.slice(0, 8), value.slice(-8));
    for (const piece of pieces) out = out.split(piece).join("[redacted]");
  }
  return out
    .replace(/(sk-|gsk_|up_)[A-Za-z0-9_*-]{4,}/g, "$1[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

const hasKey = (name) => Boolean(process.env[name]?.trim());

class LabError extends Error {
  constructor(code, status) {
    super(code);
    this.status = status;
  }
}

function takePaidCall(counter) {
  if (calls[counter] >= MAX_PAID_CALLS_PER_ENGINE) throw new LabError("budget", 429);
  calls[counter] += 1;
}

async function analyzeGroq(images, prompt) {
  if (!hasKey("GROQ_API_KEY")) throw new LabError("not_configured", 400);
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 120_000 });
  calls.groqQwen += 1;
  const completion = await groq.chat.completions.create({
    model: GROQ_VISION_MODEL,
    max_completion_tokens: 2048,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      },
    ],
  });
  const choice = completion.choices[0];
  return {
    model: GROQ_VISION_MODEL,
    text: stripThinking(choice?.message?.content ?? ""),
    finishReason: choice?.finish_reason ?? null,
    usage: completion.usage ?? null,
  };
}

async function analyzeOpenAI(images, prompt) {
  if (!hasKey("OPENAI_API_KEY")) throw new LabError("not_configured", 400);
  if (images.length !== 1) throw new LabError("one_image_per_request", 400);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 120_000 });
  const notes = [];
  let detail = "original";
  let reasoning = "none";
  // 매개변수가 거부되면 그 매개변수를 빼고 다시 보낸다(최대 2회 더). 거부 사실은 notes로 돌려준다.
  for (let attempt = 0; attempt < 3; attempt++) {
    takePaidCall("openai");
    try {
      const request = {
        model: OPENAI_MODEL,
        max_completion_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: detail ? { url: images[0], detail } : { url: images[0] } },
            ],
          },
        ],
      };
      if (reasoning) request.reasoning_effort = reasoning;
      const completion = await client.chat.completions.create(request);
      const choice = completion.choices[0];
      return {
        model: completion.model ?? OPENAI_MODEL,
        text: (choice?.message?.content ?? "").trim(),
        finishReason: choice?.finish_reason ?? null,
        usage: completion.usage ?? null,
        params: { detail: detail ?? "default", reasoning_effort: reasoning ?? "default" },
        notes,
      };
    } catch (error) {
      const message = redact(error?.message ?? error);
      if (error?.status === 400 && reasoning && /reasoning/i.test(message)) {
        notes.push(`reasoning_effort=${reasoning} 거부: ${message.slice(0, 160)}`);
        reasoning = null;
        continue;
      }
      if (error?.status === 400 && detail && /detail/i.test(message)) {
        notes.push(`detail=${detail} 거부: ${message.slice(0, 160)}`);
        detail = null;
        continue;
      }
      throw error;
    }
  }
  throw new LabError("params_rejected", 400);
}

async function analyzeUpstage(images) {
  if (!hasKey("UPSTAGE_API_KEY")) throw new LabError("not_configured", 400);
  if (images.length !== 1) throw new LabError("one_image_per_request", 400);
  takePaidCall("upstage");
  const [, mime, b64] = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(images[0]);
  const form = new FormData();
  form.append("document", new Blob([Buffer.from(b64, "base64")], { type: mime }), `tile.${mime.split("/")[1]}`);
  form.append("model", "ocr");
  const response = await fetch(UPSTAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTAGE_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(redact(data?.error?.message ?? data?.message ?? `upstage_${response.status}`));
    error.status = response.status;
    throw error;
  }
  const words = (data.pages ?? []).flatMap((page) => page.words ?? []);
  const confidences = words.map((word) => word.confidence).filter((c) => typeof c === "number");
  return {
    model: "upstage-ocr",
    text: data.text ?? "",
    finishReason: "stop",
    usage: data.usage ?? null,
    pages: data.usage?.pages ?? null,
    minConfidence: confidences.length ? Math.min(...confidences) : null,
    avgConfidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
  };
}

async function analyze({ images, kind, engine = "groq" }) {
  if (!Array.isArray(images) || images.length === 0) throw new LabError("no_images", 400);
  if (images.length > MAX_IMAGES_PER_REQUEST) throw new LabError("too_many_images", 400);
  if (!images.every((url) => /^data:image\/(jpeg|png|webp);base64,/.test(url)))
    throw new LabError("bad_image_format", 400);
  const prompt = PROMPTS[kind] ?? PROMPTS.summary;
  const started = Date.now();
  let result;
  if (engine === "openai") result = await analyzeOpenAI(images, prompt);
  else if (engine === "upstage") result = await analyzeUpstage(images);
  else if (engine === "groq") result = await analyzeGroq(images, prompt);
  else throw new LabError("unknown_engine", 400);
  return { engine, ...result, ms: Date.now() - started, calls: { ...calls } };
}

const normalize = (text) => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// 근거(evidence)가 원문에 글자 그대로 없으면 그 항목을 null로 바꾼다(TSD §8.8 근거 대조의 초안).
export function checkEvidence(fields, sourceText) {
  const source = normalize(sourceText);
  return FIELD_KEYS.map((key) => {
    const field = fields.find((f) => f?.key === key) ?? {};
    const value = field.value == null || field.value === "" ? null : String(field.value);
    const evidence = field.evidence == null || field.evidence === "" ? null : String(field.evidence);
    if (value === null) return { key, value: null, evidence: null, check: "not_found" };
    if (evidence && source.includes(normalize(evidence))) return { key, value, evidence, check: "verified" };
    return { key, value: null, evidence, check: "unverified", rejectedValue: value };
  });
}

async function summarizeText({ text }) {
  if (typeof text !== "string" || !text.trim()) throw new LabError("no_text", 400);
  if (!hasKey("GROQ_API_KEY")) throw new LabError("not_configured", 400);
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 120_000 });
  calls.groqOss += 1;
  const started = Date.now();
  const completion = await groq.chat.completions.create({
    model: GROQ_TEXT_MODEL,
    max_completion_tokens: 1500,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: text.slice(0, 20_000) },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const fields = checkEvidence(Array.isArray(parsed.fields) ? parsed.fields : [], text);
  return { model: GROQ_TEXT_MODEL, fields, ms: Date.now() - started, usage: completion.usage ?? null, calls: { ...calls } };
}

// 계정에서 쓸 수 있는 luna 계열 모델 ID만 돌려준다(키는 서버 안에서만 쓴다).
async function listLunaModels() {
  if (!hasKey("OPENAI_API_KEY")) throw new LabError("not_configured", 400);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 30_000 });
  const ids = [];
  for await (const model of client.models.list()) ids.push(model.id);
  return { luna: ids.filter((id) => /luna/i.test(id)).sort(), total: ids.length, configured: OPENAI_MODEL };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = await readFile(path.join(here, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && req.url === "/api/status") {
      json(res, 200, {
        keyConfigured: hasKey("GROQ_API_KEY"),
        openaiKeyConfigured: hasKey("OPENAI_API_KEY"),
        upstageKeyConfigured: hasKey("UPSTAGE_API_KEY"),
        models: { groq: GROQ_VISION_MODEL, openai: OPENAI_MODEL, upstage: "ocr", summarize: GROQ_TEXT_MODEL },
        calls,
        maxPaidCallsPerEngine: MAX_PAID_CALLS_PER_ENGINE,
      });
      return;
    }
    if (req.method === "GET" && req.url === "/api/openai-models") {
      json(res, 200, await listLunaModels());
      return;
    }
    if (req.method === "POST" && req.url === "/api/analyze") {
      const body = await readBody(req);
      const result = await analyze(body);
      console.log(`[analyze] ${result.engine} ${result.model} images=${body.images.length} kind=${Object.hasOwn(PROMPTS, body.kind) ? body.kind : "summary"} ${result.ms}ms finish=${result.finishReason}`);
      json(res, 200, result);
      return;
    }
    if (req.method === "POST" && req.url === "/api/summarize-text") {
      const body = await readBody(req);
      const result = await summarizeText(body);
      console.log(`[summarize] ${result.model} ${result.ms}ms`);
      json(res, 200, result);
      return;
    }
    json(res, 404, { error: "not_found" });
  } catch (error) {
    const status = typeof error?.status === "number" ? error.status : 400;
    const message = redact(error?.message ?? error);
    const wait = /try again in ([\d.]+)s/.exec(message);
    console.log(`[error] ${status} ${message.slice(0, 300)}`);
    json(res, status, {
      error: message.slice(0, 500),
      retryAfterSec: status === 429 && wait ? Math.ceil(Number(wait[1])) + 1 : null,
      calls: { ...calls },
    });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`vision lab: http://127.0.0.1:${PORT}  groq=${hasKey("GROQ_API_KEY")} openai=${hasKey("OPENAI_API_KEY")} upstage=${hasKey("UPSTAGE_API_KEY")}`);
  });
}
