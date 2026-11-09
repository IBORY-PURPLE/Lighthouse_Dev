// 비전 실험 실행기. 실험 서버(server.mjs)를 먼저 띄운 뒤 apps/web 에서:
//   node experiments/vision/run.mjs --budget 400 [--port 4310] [--samples <폴더>]
// 브라우저(Playwright webkit, 실패하면 chromium)로 index.html을 열어 같은 자르기 코드로 조각을 만들고,
// 엔진 × 보내는 방법(통째 · 타일 1200 · 첫 상품만 타일 800)을 차례로 돌려
// 저장소 루트 test-results/vision/<시각>-<상품>-<방법>-<엔진>.json 에 결과를 쓴다(git 무시 폴더).
// 캡처 폴더(test-results/vision-samples/<상품>/)가 없으면 index.html의 합성 예시 이미지(LH-200)로 절차만 돌린다.
// 캡처 경로는 로그에 남기지 않는다(상품 폴더 이름만).
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webkit, chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const outDir = path.join(repoRoot, "test-results", "vision");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const BUDGET = Number(arg("budget", "400"));
const PORT = Number(arg("port", process.env.VISION_LAB_PORT ?? "4310"));
const SAMPLES = path.resolve(arg("samples", path.join(repoRoot, "test-results", "vision-samples")));
const BASE = `http://127.0.0.1:${PORT}`;
const PAID = { openai: "openai", upstage: "upstage" };

// 서버 카운터는 재시작하면 0이 되므로, 지난 결과 파일의 유료 호출 수를 더해 누계로 이어 받는다.
async function priorPaidCalls() {
  const used = { openai: 0, upstage: 0 };
  if (!existsSync(outDir)) return used;
  for (const name of await readdir(outDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(await readFile(path.join(outDir, name), "utf8"));
      if (data.engine in used) used[data.engine] += data.paidCalls ?? 0;
    } catch {
      // 깨진 파일은 건너뛴다.
    }
  }
  return used;
}

async function listProducts() {
  if (!existsSync(SAMPLES)) return [];
  const products = [];
  for (const entry of await readdir(SAMPLES, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "public") continue;
    const dir = path.join(SAMPLES, entry.name);
    const images = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort().map((f) => path.join(dir, f));
    if (images.length) products.push({ name: entry.name, images, hasAnswer: existsSync(path.join(dir, "answer.md")) });
  }
  return products;
}

async function launch() {
  try {
    return { browser: await webkit.launch(), name: "webkit" };
  } catch (error) {
    console.log(`[run] webkit 실패, chromium 시도: ${String(error.message).split("\n")[0]}`);
    return { browser: await chromium.launch(), name: "chromium" };
  }
}

const status = await (await fetch(`${BASE}/api/status`)).json();
const engines = [];
if (status.openaiKeyConfigured) engines.push("openai");
if (status.upstageKeyConfigured) engines.push("upstage");
if (engines.length < 2 && status.keyConfigured) engines.push("groq"); // 결정 9: Upstage가 없으면 qwen이 두 번째 엔진
console.log(`[run] 엔진 ${engines.join(", ")} · luna 모델 ${status.models.openai} · 예산 엔진당 ${BUDGET}장`);

const used = await priorPaidCalls();
console.log(`[run] 지난 결과 파일의 유료 호출 누계 luna ${used.openai} · Upstage ${used.upstage}`);

let products = await listProducts();
const synthetic = products.length === 0;
if (synthetic) {
  products = [{ name: "synthetic-LH200", images: null, hasAnswer: false }];
  console.log("[run] 캡처 폴더 없음 → 합성 예시 이미지(LH-200)로 절차만 돌린다(정답 메모 없음)");
}

const methods = (index) => [
  { label: "whole", mode: "whole", tileHeight: 1200 },
  { label: "tile1200", mode: "tiles", tileHeight: 1200 },
  ...(index === 0 ? [{ label: "tile800", mode: "tiles", tileHeight: 800 }] : []),
];

await mkdir(outDir, { recursive: true });
const { browser, name: browserName } = await launch();
const page = await browser.newPage();
await page.goto(BASE);
await page.waitForFunction(() => window.visionLab);

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
const summary = [];
// 싼 통째를 먼저, 비싼 타일을 뒤에(ai.md 블록 1 할 일 7의 순서).
const plan = [];
for (const m of ["whole", "tile1200", "tile800"])
  products.forEach((product, index) => {
    const method = methods(index).find((x) => x.label === m);
    if (method) for (const engine of engines) plan.push({ product, method, engine });
  });

for (const { product, method, engine } of plan) {
  const opts = { mode: method.mode, tileHeight: method.tileHeight, engine, kind: "ocr", maxWidth: 1000, overlap: 100, summarize: true };
  if (!synthetic) await page.setInputFiles("#files", product.images);
  const tileCount = await page.evaluate(async ({ synthetic, opts }) => {
    const files = synthetic ? [await window.visionLab.makeSampleFile()] : [...document.getElementById("files").files];
    let n = 0;
    for (const f of files) n += (await window.visionLab.prepare(f, opts.mode, opts.maxWidth, opts.tileHeight, opts.overlap)).length;
    return n;
  }, { synthetic, opts });
  const key = `${product.name}-${method.label}-${engine}`;
  if (PAID[engine] && used[engine] + tileCount > BUDGET) {
    console.log(`[run] ${key}: 미실행(예산 상한, 누계 ${used[engine]} + ${tileCount} > ${BUDGET})`);
    summary.push({ key, skipped: "budget" });
    continue;
  }
  // 호출 전에 최대 호출 수(조각 수 × 엔진 최대 재시도)로 임시 기록을 먼저 써 둔다.
  // 실행이 중간에 끊겨도 다음 실행이 이 수를 누계에 넣어 상한을 넘지 않는다. 끝나면 실제 수로 덮어쓴다.
  const file = path.join(outDir, `${stamp}-${key}.json`);
  const maxAttempts = engine === "openai" ? 3 : 1;
  await writeFile(file, JSON.stringify({ product: product.name, method: method.label, engine, pending: true, paidCalls: PAID[engine] ? tileCount * maxAttempts : 0 }));
  const before = (await (await fetch(`${BASE}/api/status`)).json()).calls;
  const started = Date.now();
  const result = await page.evaluate(async ({ synthetic, opts }) => {
    const files = synthetic ? [await window.visionLab.makeSampleFile()] : [...document.getElementById("files").files];
    return window.visionLab.runAnalysis({ ...opts, files });
  }, { synthetic, opts });
  const totalMs = Date.now() - started;
  // 실제 호출 수는 서버 카운터 차이로 센다(매개변수 거부로 재시도한 호출도 포함).
  const after = (await (await fetch(`${BASE}/api/status`)).json()).calls;
  const delta = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]));
  const paidCalls = PAID[engine] ? delta[PAID[engine]] : 0;
  if (PAID[engine]) used[engine] += paidCalls;
  const record = {
    product: product.name, synthetic, hasAnswer: product.hasAnswer, method: method.label, browser: browserName,
    ...result, totalMs, summarizeMs: result.summary?.ms ?? null, paidCalls, callsDelta: delta,
  };
  record.engine = engine;
  await writeFile(file, JSON.stringify(record, null, 2));
  console.log(`[run] ${key}: 조각 ${result.tiles}(실패 ${result.failed}) · 읽기 ${result.readMs}ms · 요약 ${record.summarizeMs ?? "-"}ms · 전체 ${totalMs}ms · 유료 ${paidCalls}`);
  summary.push({ key, tiles: result.tiles, failed: result.failed, readMs: result.readMs, totalMs, paidCalls });
}

await browser.close();
const final = await (await fetch(`${BASE}/api/status`)).json();
console.log(`[run] 끝. 서버 호출 ${JSON.stringify(final.calls)} · 결과 파일 ${summary.filter((s) => !s.skipped).length}개`);
