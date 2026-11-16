const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// ========================================
// AI 시스템 프롬프트
// ========================================

const instructions = `
당신은 시각장애인을 위한 LightHouse 음성 상품 요청 도우미입니다.

[기본 역할]
사용자가 원하는 상품을 찾을 수 있도록
음성 대화를 통해 구매 조건을 구체화합니다.

[대화 방식]
1. 모든 대화는 한국어로 진행하세요.
2. 짧고 자연스러운 존댓말을 사용하세요.
3. 한 번에 질문은 하나만 하세요.
4. 사용자가 이미 답변한 내용은 다시 질문하지 마세요.
5. 사용자가 모른다거나 상관없다고 하면 해당 조건은 넘어가세요.
6. 사용자의 답변을 이해했다면 불필요하게 반복하거나 설명하지 말고 다음 질문으로 넘어가세요.
7. 대화가 실제 사람과 이루어지는 것처럼 자연스럽게 이어지도록 하세요.
8. 개인정보는 요청하지 마세요.
9. 가격, 재고, 상품 기능을 실제 확인한 것처럼 말하지 마세요.

[질문 방식 - 중요]
1. 질문할 때 예시를 덧붙이지 마세요.
2. "예를 들어", "예를 들면", "~같은 것" 등의 표현을 사용하지 마세요.
3. 사용자가 답변하기 쉽도록 간결하고 직접적인 질문만 하세요.
4. 질문 뒤에 가능한 답변이나 선택지를 나열하지 마세요.
5. 한 번의 질문에는 하나의 정보만 요청하세요.
6. 사용자가 예시를 요청하거나 질문을 이해하지 못했을 때만 예시를 제공하세요.
7. 불필요한 설명이나 부연 설명을 추가하지 마세요.
8. 질문은 가능하면 한 문장으로 작성하세요.
9. 사용자의 답변을 유도하거나 특정 선택을 권유하지 마세요.

[상품 조건 파악]
다음 정보를 필요한 범위에서 파악하세요.

- 상품 종류
- 사용 목적
- 예산 (선택)
- 유선 또는 무선 여부
- 가장 중요한 기능
- 기타 사용자가 원하는 조건

모든 항목을 반드시 질문할 필요는 없습니다.

상품 종류에 따라 적절한 질문을 선택하세요.

사용자가 이미 여러 조건을 한 번에 설명했다면
해당 조건을 다시 질문하지 마세요.

충분한 정보가 수집되면
불필요한 추가 질문 없이 구매 요청 확인 단계로 넘어가세요.

[구매 요청 확인]
충분한 정보가 수집되면
사용자의 구매 요청을 1~2문장으로 정리하세요.

그다음 반드시 사용자에게
"이 내용으로 구매 요청을 등록할까요?"
라고 확인하세요.

사용자가 명시적으로 동의하기 전에는
절대 구매 요청을 등록하지 마세요.

사용자가 조건을 수정하면
수정 내용을 반영하고 다시 확인하세요.

[상태 관리]
asking:
구매 조건을 질문하는 단계입니다.

confirming:
구매 요청을 요약하고 사용자 확인을 기다리는 단계입니다.

done:
사용자가 최종 요청 내용을 명시적으로 확인한 단계입니다.

사용자가 최종 확인을 하기 전에는
done을 반환하면 안 됩니다.

[JSON 응답 규칙]
모든 응답은 반드시 유효한 JSON 객체 형식으로 작성하세요.

JSON 객체에는 다음 필드를 포함해야 합니다.

{
  "reply": "사용자에게 음성으로 전달할 짧은 한국어 문장",
  "status": "asking",
  "summary": "",
  "product": ""
}

status는 asking, confirming, done 중 하나여야 합니다.

reply:
사용자에게 말할 내용입니다.

summary:
사용자가 최종 확인한 구매 요청 내용입니다.
최종 확인 전에는 빈 문자열로 반환하세요.

product:
요청한 상품의 짧은 이름입니다.

JSON 외의 설명이나 마크다운은 출력하지 마세요.

첫 대화에서는 상품 종류를 묻는 짧고 자연스러운 질문으로 시작하세요.
`;

// ========================================
// 세션 관리
// ========================================

const sessions = new Map();

const send = (res, status, obj) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(obj));
};

const trimSessions = () => {
  for (const [id, s] of sessions) {
    if (Date.now() - s.updated > 3600000) {
      sessions.delete(id);
    }
  }

  if (sessions.size > 200) {
    const oldest = [...sessions.entries()].sort(
      (a, b) => a[1].updated - b[1].updated
    );

    oldest
      .slice(0, sessions.size - 200)
      .forEach(([id]) => sessions.delete(id));
  }
};

// ========================================
// OpenAI API 호출
// ========================================

async function callAI(history) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    25000
  );

  try {
    const r = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          model: MODEL,

          instructions,

          input: [
            {
              role: 'developer',
              content: '반드시 JSON 객체로 답변하세요.'
            },
            ...history
          ],

          max_output_tokens: 450,

          text: {
            format: {
              type: 'json_object'
            }
          },

          store: false
        }),

        signal: controller.signal
      }
    );

    const data = await r.json();

    if (!r.ok) {
      throw new Error(
        data.error?.message ||
        `OpenAI HTTP ${r.status}`
      );
    }

    const raw = (data.output || [])
      .flatMap(x => x.content || [])
      .filter(x => x.type === 'output_text')
      .map(x => x.text)
      .join('');

    const parsed = JSON.parse(raw);

    if (
      !parsed.reply ||
      !['asking', 'confirming', 'done'].includes(parsed.status)
    ) {
      throw new Error('AI 응답 형식 오류');
    }

    return parsed;

  } finally {
    clearTimeout(timer);
  }
}

// ========================================
// 세션 ID 검증
// ========================================

const safeId = id =>
  typeof id === 'string' &&
  /^[a-zA-Z0-9-]{8,100}$/.test(id);

// ========================================
// HTTP 서버
// ========================================

const server = http.createServer(async (req, res) => {

  // 메인 페이지
  if (
    req.method === 'GET' &&
    (req.url === '/' || req.url === '/index.html')
  ) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    return fs
      .createReadStream(
        path.join(__dirname, 'public/index.html')
      )
      .pipe(res);
  }

  // 서버 상태 확인
  if (
    req.method === 'GET' &&
    req.url === '/api/health'
  ) {
    return send(res, 200, {
      ok: true,
      configured: !!KEY
    });
  }

  // AI 대화 API
  if (
    req.method === 'POST' &&
    req.url === '/api/chat'
  ) {
    let body = '';

    try {
      for await (const chunk of req) {
        body += chunk;

        if (body.length > 12000) {
          throw new Error('요청이 너무 큽니다');
        }
      }

      const {
        sessionId,
        message,
        reset
      } = JSON.parse(body);

      if (!safeId(sessionId)) {
        return send(res, 400, {
          error: '세션 식별자 오류'
        });
      }

      if (!KEY) {
        return send(res, 503, {
          error: '서버에 OPENAI_API_KEY가 설정되지 않았습니다.'
        });
      }

      trimSessions();

      let s = sessions.get(sessionId);

      if (reset || !s) {
        s = {
          history: [],
          updated: Date.now(),
          busy: false
        };

        sessions.set(sessionId, s);
      }

      if (s.busy) {
        return send(res, 409, {
          error: '이전 응답을 처리 중입니다.'
        });
      }

      if (
        typeof message !== 'string' ||
        message.length > 1000
      ) {
        return send(res, 400, {
          error: '메시지 길이 오류'
        });
      }

      if (!reset && !message.trim()) {
        return send(res, 400, {
          error: '답변을 입력해 주세요'
        });
      }

      if (s.history.length >= 36) {
        return send(res, 400, {
          error:
            '대화가 너무 길어졌습니다. 새 요청을 시작해 주세요.'
        });
      }

      s.busy = true;

      try {
        const input = reset
          ? '대화를 시작해 주세요. 첫 질문을 해주세요.'
          : message.trim();

        const next = [
          ...s.history,
          {
            role: 'user',
            content: input
          }
        ];

        const result = await callAI(next);

        s.history = [
          ...next,
          {
            role: 'assistant',
            content: JSON.stringify(result)
          }
        ];

        s.updated = Date.now();

        return send(res, 200, result);

      } finally {
        s.busy = false;
      }

    } catch (e) {
      console.error('chat error:', e.message);

      return send(res, 500, {
        error:
          e.name === 'AbortError'
            ? 'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.'
            : 'AI 요청에 실패했습니다. 서버 설정과 API 사용량을 확인해 주세요.'
      });
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

// ========================================
// 서버 실행
// ========================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LightHouse: http://localhost:${PORT}`);
});
