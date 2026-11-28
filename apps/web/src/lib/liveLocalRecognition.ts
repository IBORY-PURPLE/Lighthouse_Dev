import type { LiveRecognition } from "@/lib/liveFallbackEngine";

const TRANSCRIBE_PATH = "/api/live/transcribe";
const FRAME_MS = 30;
const SPEECH_LEVEL = 0.012;
const START_FRAMES = 3;
const END_SILENCE_MS = 750;
const MAX_SPEECH_MS = 12_000;

export type MicDiagnostic = (event: string, detail?: string) => void;

export function postMicDiagnostic(win: Window, event: string, detail = ""): void {
  void win.fetch(TRANSCRIBE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, detail: detail.slice(0, 120) }),
    keepalive: true,
  }).catch(() => {});
}

export function localRecognitionAvailable(win: Window): boolean {
  return typeof win.navigator.mediaDevices?.getUserMedia === "function"
    && typeof MediaRecorder === "function" && typeof AudioContext === "function";
}

/** Adapt a recorded utterance to the same events the fallback engine uses for Web Speech. */
export function createLocalRecognition(win: Window, debug?: MicDiagnostic): LiveRecognition {
  let stream: MediaStream | undefined;
  let audio: AudioContext | undefined;
  let recorder: MediaRecorder | undefined;
  let meter: number | undefined;
  let controller: AbortController | undefined;
  let ended = false;
  let heardAt = 0;
  let loudAt = 0;
  let loudFrames = 0;

  function releaseMic() {
    win.clearInterval(meter);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    if (audio) void audio.close().catch(() => {});
    audio = undefined;
  }

  function finish(error?: string) {
    if (ended) return;
    ended = true;
    releaseMic();
    if (error) recognition.onerror?.({ error });
    recognition.onend?.();
  }

  async function transcribe(chunks: Blob[], mediaType: string) {
    if (ended) return;
    releaseMic();
    if (!heardAt || !chunks.length) {
      debug?.("cancel_capture", "발화 감지 없음");
      finish();
      return;
    }
    controller = new AbortController();
    try {
      const response = await win.fetch(TRANSCRIBE_PATH, {
        method: "POST",
        body: new Blob(chunks, { type: mediaType }),
        ...(debug ? { headers: { "x-live-mic-debug": "1" } } : {}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      debug?.("recognition_http", String(response.status));
      if (!response.ok) throw new Error("transcription_unavailable");
      const data: unknown = await response.json();
      if (ended) return;
      if (data && typeof data === "object" && "text" in data && typeof data.text === "string" && data.text.trim()) {
        const result = Object.assign([{ transcript: data.text.trim() }], { isFinal: true });
        recognition.onresult?.({ results: [result] });
      }
      finish();
    } catch {
      finish("service-not-allowed");
    }
  }

  async function start() {
    let captured: MediaStream;
    debug?.("mic_request");
    try {
      captured = await win.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      debug?.("mic_error", name || "getUserMedia");
      finish(name === "NotAllowedError" || name === "SecurityError" ? "not-allowed" : "audio-capture");
      return;
    }
    if (ended) {
      captured.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = captured;
    const track = stream.getAudioTracks()[0];
    debug?.("mic_connected", track ? `${track.label || "기본 장치"} · muted=${track.muted}` : "오디오 트랙 없음");
    try {
      audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream, { audioBitsPerSecond: 48_000 });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => finish("audio-capture");
      recorder.onstop = () => { void transcribe(chunks, recorder?.mimeType ?? "audio/webm"); };
      await audio.resume();
      if (ended) return;
      recorder.start();
      let lastLevelAt = 0;
      let peak = 0;
      meter = win.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const value of samples) energy += value * value;
        const now = Date.now();
        const rms = Math.sqrt(energy / samples.length);
        if (debug) {
          peak = Math.max(rms, peak);
          if (now - lastLevelAt >= 1_000) {
            const db = Math.round(20 * Math.log10(Math.max(peak, 0.00001)));
            debug("level", `${db} dBFS · 발화 감지=${heardAt !== 0} · muted=${track?.muted ?? "?"}`);
            peak = 0;
            lastLevelAt = now;
          }
        }
        if (rms >= SPEECH_LEVEL) {
          loudFrames += 1;
          loudAt = now;
          if (!heardAt && loudFrames >= START_FRAMES) {
            heardAt = now;
            debug?.("speech");
            recognition.onspeechstart?.();
          }
        } else {
          loudFrames = 0;
        }
        if (heardAt && (now - loudAt >= END_SILENCE_MS || now - heardAt >= MAX_SPEECH_MS)) recognition.stop?.();
      }, FRAME_MS);
      recognition.onstart?.();
    } catch (error) {
      debug?.("mic_error", error instanceof Error ? error.name : "recording_start");
      finish("audio-capture");
    }
  }

  const recognition: LiveRecognition = {
    lang: "ko-KR",
    continuous: false,
    interimResults: false,
    maxAlternatives: 1,
    onstart: null,
    onspeechstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    start() { void start(); },
    stop() {
      win.clearInterval(meter);
      if (recorder?.state === "recording") {
        if (heardAt) debug?.("upload");
        recorder.stop();
      }
      else if (!recorder) finish();
    },
    abort() {
      if (!ended) debug?.("cancel_capture", heardAt ? "진행 중인 녹음·전사 중단" : "마이크 닫힘");
      ended = true;
      controller?.abort();
      if (recorder?.state === "recording") recorder.stop();
      releaseMic();
    },
  };
  return recognition;
}
