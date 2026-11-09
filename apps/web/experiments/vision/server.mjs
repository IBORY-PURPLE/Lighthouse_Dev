// 비전 AI 육안 확인용 로컬 실험 서버. 제품 코드가 아니며 배포하지 않는다.
// 실행: apps/web 에서 `node experiments/vision/server.mjs` → http://127.0.0.1:4310
// 키: apps/web/.env.local 또는 저장소 루트 .env 의 GROQ_API_KEY 를 읽는다(값은 출력하지 않는다).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Groq from "groq-sdk";

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
const MAX_IMAGES_PER_REQUEST = 3; // Groq qwen/qwen3.8-27b 제한
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const MODELS = ["qwen/qwen3.8-27b"];

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
  ocr: "첨부된 이미지에 보이는 글자를 위에서 아래 순서대로 빠짐없이 그대로 옮겨 적어라. 요약하거나 고치지 말고, 읽을 수 없는 글자는 [?]로 표시하라.",
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
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

async function analyze({ images, kind, model }) {
  if (!Array.isArray(images) || images.length === 0)
    throw new Error("no_images");
  if (images.length > MAX_IMAGES_PER_REQUEST) throw new Error("too_many_images");
  if (!images.every((url) => /^data:image\/(jpeg|png|webp);base64,/.test(url)))
    throw new Error("bad_image_format");
  const prompt = PROMPTS[kind] ?? PROMPTS.summary;
  const chosenModel = MODELS.includes(model) ? model : MODELS[0];

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 120_000 });
  const started = Date.now();
  const completion = await groq.chat.completions.create({
    model: chosenModel,
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
    model: chosenModel,
    text: stripThinking(choice?.message?.content ?? ""),
    finishReason: choice?.finish_reason ?? null,
    ms: Date.now() - started,
    usage: completion.usage ?? null,
  };
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
        keyConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
        openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
        upstageKeyConfigured: Boolean(process.env.UPSTAGE_API_KEY?.trim()),
        models: MODELS,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/analyze") {
      const body = await readBody(req);
      const result = await analyze(body);
      console.log(`[analyze] ${result.model} images=${body.images.length} kind=${body.kind} ${result.ms}ms finish=${result.finishReason}`);
      json(res, 200, result);
      return;
    }
    json(res, 404, { error: "not_found" });
  } catch (error) {
    const status = typeof error?.status === "number" ? error.status : 400;
    const message = error?.message ?? String(error);
    const wait = /try again in ([\d.]+)s/.exec(message);
    console.log(`[error] ${status} ${message.slice(0, 300)}`);
    json(res, status, {
      error: message.slice(0, 500),
      retryAfterSec: status === 429 && wait ? Math.ceil(Number(wait[1])) + 1 : null,
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`vision lab: http://127.0.0.1:${PORT}  key=${Boolean(process.env.GROQ_API_KEY?.trim())}`);
});
