"""Local Korean transcription for the Brave preview.

Run with uv run --no-project --with faster-whisper==1.2.1 --with av==16.1.0 python experiments/local_transcription.py
"""

import io
import json
import os
import threading
import time
from collections import Counter, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from faster_whisper import WhisperModel

MODEL = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
INFERENCE = threading.BoundedSemaphore(1)
MAX_BYTES = 512 * 1024
DEBUG = os.environ.get("LIVE_MIC_DIAGNOSTICS") == "on"
EVENT_COUNTS = Counter()
STATE_LOCK = threading.Lock()
LAST = {}
EVENTS = deque(maxlen=120)
EVENT_SEQ = 0
LABELS = {
    "screen": "대화 화면 열림",
    "state": "대화 상태",
    "mic_request": "마이크 열기 요청",
    "mic_connected": "마이크 연결됨",
    "mic_error": "마이크·음성 오류",
    "level": "마이크 입력 레벨",
    "speech": "말소리 감지",
    "upload": "녹음 마침 · 전사 요청",
    "recognition_http": "전사 요청 응답",
    "cancel_capture": "듣기 종료",
    "advance": "차례 넘김",
    "hold_answer": "답을 모으는 중",
    "echo_filtered": "전사 처리 건너뜀",
    "stt_started": "서버에 음성 도착",
    "transcript": "받아쓴 말",
    "stt_empty": "받아쓴 말 없음",
    "stt_error": "전사 실패",
}


def trace(event, detail=""):
    global EVENT_SEQ
    suffix = "".join(c for c in detail if c.isprintable())[:1000]
    with STATE_LOCK:
        EVENT_COUNTS[event] += 1
        if event in {"screen", "state", "level", "mic_error", "recognition_http", "stt_error"}:
            LAST[event] = suffix
        EVENT_SEQ += 1
        EVENTS.append({"id": EVENT_SEQ, "at": time.time(), "label": LABELS[event], "detail": suffix})


class TranscriptionHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except ConnectionError:
            pass

    def do_GET(self):
        url = urlsplit(self.path)
        if DEBUG and url.path == "/diagnostic/events":
            try:
                after = int(parse_qs(url.query).get("after", ["0"])[0])
            except ValueError:
                self.send_json(400, {"error": "invalid_cursor"})
                return
            with STATE_LOCK:
                recent = time.time() - 120
                events = [row for row in EVENTS if row["id"] > after and row["at"] >= recent]
                cursor = EVENT_SEQ
            self.send_json(200, {"cursor": cursor, "events": events})
            return
        if self.path == "/health":
            with STATE_LOCK:
                state = {"ready": True, "diagnostics": DEBUG}
                if DEBUG:
                    state.update(counts=dict(EVENT_COUNTS), last=dict(LAST))
            self.send_json(200, state)
        else:
            self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        diagnostic = self.path == "/diagnostic" and DEBUG
        if self.path != "/transcribe" and not diagnostic:
            self.send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= (512 if diagnostic else MAX_BYTES):
            self.send_json(400, {"error": "invalid_length"})
            return
        self.connection.settimeout(8)
        try:
            audio = self.rfile.read(length)
        except OSError:
            return
        if diagnostic:
            try:
                payload = json.loads(audio)
                event, detail = payload["event"], payload["detail"]
                if event not in LABELS or not isinstance(detail, str):
                    raise ValueError
            except (ValueError, TypeError, KeyError):
                self.send_json(400, {"error": "invalid_diagnostic"})
            else:
                trace(event, detail)
                self.send_json(200, {"ok": True})
            return
        show = DEBUG and self.headers.get("x-live-mic-debug") == "1"
        if show:
            trace("stt_started", f"{length:,} bytes")
        if not INFERENCE.acquire(blocking=False):
            if show:
                trace("stt_error", "다른 음성 처리 중")
            self.send_json(503, {"error": "busy"})
            return
        try:
            segments, _ = MODEL.transcribe(
                io.BytesIO(audio),
                language="ko",
                beam_size=3,
                vad_filter=True,
                condition_on_previous_text=False,
                initial_prompt="다음. 헤드셋, 다음. 끝내기.",
                hotwords="다음, 다음, 다 했어요, 끝내기, 헤드셋",
            )
            transcript = " ".join(segment.text.strip() for segment in segments).strip()
        except Exception as error:
            if show:
                trace("stt_error", type(error).__name__)
            self.send_json(422, {"error": "invalid_audio"})
        else:
            if show:
                trace("transcript" if transcript else "stt_empty", transcript)
            self.send_json(200, {"text": transcript})
        finally:
            INFERENCE.release()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8784), TranscriptionHandler)
    print("Local Korean transcription ready on 127.0.0.1:8784", flush=True)
    if DEBUG:
        print("LightHouse 음성 진단 · http://localhost:3001/live?mic_debug=1", flush=True)
        print("마이크 레벨 → 말소리 감지 → 받아쓴 말 → '다음'을 기다리는지 표시합니다.", flush=True)
    server.serve_forever()
