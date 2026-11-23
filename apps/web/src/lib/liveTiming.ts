// /live 시간 상수. 상태 기계, 실행기, 두 엔진이 함께 쓴다. 설계서 5.2절. 값은 모두 [제안값]이라 시험으로 조정한다.
import { SPEECH_START_DELAY_MS } from "@/lib/speech";   // 1000. 버튼 낭독이 인식에 섞이지 않게 기다리는 시간

export const MIC_SETTLE_MS = SPEECH_START_DELAY_MS;      // 단추를 누른 직후 차례를 열 때 띵 앞에 두는 뜸
export const EARCON_TO_MIC_MS = 150;                     // 신호음이 끝난 뒤 마이크를 여는 간격
export const LISTEN_LATE_MS = 1_500;                     // 인식 시작이 이보다 늦으면 허용 창이 떴다고 본다
export const MAX_LATE_REOPENS = 2;
export const MIC_WAIT_MS = 60_000;                       // Realtime 마이크 허용을 기다리는 상한
export const CONNECT_TIMEOUT_MS = 12_000;                // 마이크를 받은 뒤부터 잰다
export const CONNECT_SAY_MS = 1_500;                     // 이보다 오래 걸릴 때만 "연결하고 있어요"를 알린다
export const REALTIME_OPEN_TIMEOUT_MS = 8_000;
export const RELISTEN_DELAYS_MS = [300, 600, 1_200, 2_000] as const;  // 다시 들을 때마다 늘린다. 넷째 뒤로는 2초
export const SILENCE_STEPS_MS = [10_000, 15_000, 15_000, 20_000] as const; // 힌트1, 힌트2, 연장 질문, 멈춤
export const CONTROL_HOLD_MS = 4_000;
export const WAIT_PULSE_MS = 1_500;
export const WAIT_SAY1_MS = 4_000;
export const WAIT_SAY2_MS = 12_000;
export const THINK_TIMEOUT_MS = 30_000;
export const CHAT_FETCH_TIMEOUT_MS = 28_000;             // 서버 25초 + 여유
export const TRANSCRIPT_WAIT_MS = 1_500;                 // Realtime 전사를 기다리는 상한
export const SPEAK_GUARD_MAX_MS = 30_000;                // Realtime AI 말이 끝났다는 신호를 기다리는 상한
export const REALTIME_TURN_MAX_MS = 60_000;              // 말이 시작된 뒤 commit이 없을 때 끊는 상한
export const REGISTER_SAY_MS = 1_500;
export const PAUSED_WARN_MS = 100_000;
export const PAUSED_END_MS = 120_000;
export const REALTIME_IDLE_CLOSE_MS = 30_000;
export const MAX_AI_FAILURES = 3;
export const MAX_RATE_RETRIES = 2;
export const RETRY_AFTER_CAP_MS = 30_000;
export const MAX_RECONNECTS = 1;
export const HISTORY_SEND_MAX = 34;                      // 서버 상한 36칸 미만에 맞춘다
export const USER_TURN_MAX = 1_000;                      // 기록에 넣는 이용자 글 상한(서버 message 상한과 같다)
