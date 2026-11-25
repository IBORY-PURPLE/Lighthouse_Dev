const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const PUBLIC_DIRECTORY = path.join(__dirname, 'public');
const MAX_BODY_LENGTH = 12000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const FIRST_QUESTION = '어떤 상품을 찾고 계신가요?';

const sessions = new Map();

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const ANSWER_TURN_INSTRUCTIONS = `
당신은 시각장애인을 위한 LightHouse 상품 요청 도우미입니다.
현재 사용자의 답변을 이해한 뒤 다음 질문까지 한 번에 준비하세요.
LightHouse는 이 서비스의 이름이며 상품 브랜드나 상품 종류가 아닙니다.
사용자는 전자제품, 생활용품, 식품 등 모든 일반 쇼핑 상품을 요청할 수 있습니다.
시각장애인용 상품이나 점자 상품으로 범위를 임의로 제한하지 마세요.

규칙:
- 사용자가 상품을 바꾸거나 처음부터 다시 고르고 싶다는 의사를 표현하면 현재 질문과 무관하더라도 거절하지 말고 action을 change_product로 지정하세요.
- 변경할 새 상품을 함께 말했다면 replacementProduct에 새 상품명만 담고, 기존 상품과 기존 조건은 모두 무시한 채 새 상품에 맞는 후속 질문을 만드세요.
- 변경 의사만 말하고 새 상품을 말하지 않았다면 replacementProduct와 nextQuestion을 빈 문자열로 반환하세요.
- 짧은 답변, '상관없어요', '모르겠어요', '없어요'도 유효한 답변입니다.
- 현재 질문과 전혀 관계없는 말, 의미를 알 수 없는 말, 음성 인식 오류로 보이는 말만 거절하세요.
- 답변을 거절할 때는 사용자의 말을 짧게 받아준 뒤 현재 질문을 자연스럽게 다시 물어보는 reply를 작성하세요.
- 이전 질문과 답변을 참고해 자연스럽게 이어지는 질문 하나만 만드세요.
- 한 번에 조건 하나만 묻고, 개인정보는 요청하지 마세요.
- 정해진 질문 목록을 기계적으로 따르지 말고 사용자의 답변에 맞춰 필요한 내용을 유연하게 물어보세요.
- 상품 종류, 예산, 사용 목적, 선호 기능, 가장 중요한 조건, 기타 요청 중 이미 답한 내용은 건너뛰고 아직 부족한 내용을 여섯 질문 안에서 파악하세요.
- 모호하거나 독특한 요청도 일반적인 선택지로 억지로 제한하지 말고, 사용자의 표현을 존중하면서 구체화하세요.
- 이미 답한 내용을 다시 묻지 마세요.
- 질문은 짧고 명확하게 작성하세요.
- 질문 순서 표현은 서버가 붙이므로 '첫 번째 질문입니다' 같은 표현을 넣지 마세요.
- 일반 답변을 받아들이면 반드시 {"accepted":true,"action":"answer","reply":"","replacementProduct":"","nextQuestion":"다음 질문"} 형식으로 반환하세요. 현재 질문이 여섯 번째이면 nextQuestion은 빈 문자열이어야 합니다.
- 상품 변경 요청이면 반드시 {"accepted":true,"action":"change_product","reply":"","replacementProduct":"새 상품명 또는 빈 문자열","nextQuestion":"새 상품에 맞는 질문 또는 빈 문자열"} 형식으로 반환하세요.
- 답변을 거절하면 반드시 {"accepted":false,"action":"retry","reply":"자연스러운 응답과 현재 질문","replacementProduct":"","nextQuestion":""} 형식으로 반환하세요.
`;

const SUMMARY_INSTRUCTIONS = `
당신은 시각장애인을 위한 LightHouse 상품 요청 도우미입니다.
여섯 개 질문과 답변을 구매 요청 정보로 정리하세요.

반드시 다음 형식의 JSON 객체만 반환하세요.
{
  "productName": "목록에 표시할 짧은 상품명",
  "summaryText": "사용자의 요청 조건을 모두 포함해 자연스럽게 정리한 한 문장",
  "requirements": {
    "product": "요청 상품",
    "budget": "예산 또는 상관없음",
    "purpose": "사용 목적",
    "preferences": "선호 조건",
    "priority": "중요한 점",
    "additionalNotes": "기타 요청 또는 없음"
  }
}

summaryText는 사용자가 한 번에 들을 수 있도록 반드시 마침표 하나로 끝나는 한 문장으로 작성하세요.
답변에 없는 사실을 만들어내지 마세요.
`;

const ANSWER_VALIDATION_INSTRUCTIONS = `
당신은 시각장애인과 음성으로 자연스럽게 대화하는 LightHouse 상품 요청 도우미입니다.
한국어 음성 인식 결과가 현재 질문에 대한 답변으로 이해 가능한지 판단하세요.
짧은 답변, '상관없어요', '모르겠어요', '없어요'도 유효한 답변입니다.
질문과 전혀 관계없는 말, 문장이 끊겨 의미를 알 수 없는 말, 음성 인식 오류로 보이는 말은 거절하세요.
거절할 때는 같은 고정 문구를 반복하지 말고 사용자의 말을 짧게 받아준 뒤, 왜 이해하기 어려웠는지 자연스럽게 설명하고 현재 질문을 다시 물어보세요.
사용자가 엉뚱한 말이나 질문을 하더라도 무시하거나 꾸짖지 말고 대화하듯 부드럽게 현재 주제로 돌아오세요.
reply는 음성으로 듣기 편한 짧은 한두 문장으로 작성하세요.
반드시 {"accepted":true,"reply":""} 또는 {"accepted":false,"reply":"자연스러운 응답과 현재 질문"} 형식의 JSON 객체만 반환하세요.
`;

const CORRECTION_INSTRUCTIONS = `
당신은 시각장애인을 위한 LightHouse 상품 요청 도우미입니다.
기존 구매 요청에서 사용자가 말한 수정 내용만 반영하고 나머지 조건은 그대로 유지하세요.
사용자가 요청하지 않은 조건을 추가하거나 삭제하지 마세요.

반드시 다음 형식의 JSON 객체만 반환하세요.
{
  "productName": "목록에 표시할 짧은 상품명",
  "summaryText": "수정된 요청 조건을 모두 포함한 자연스러운 한 문장",
  "requirements": {
    "product": "요청 상품",
    "budget": "예산 또는 상관없음",
    "purpose": "사용 목적",
    "preferences": "선호 조건",
    "priority": "중요한 점",
    "additionalNotes": "기타 요청 또는 없음"
  }
}

summaryText는 반드시 마침표 하나로 끝나는 한 문장으로 작성하세요.
`;

const sendJson = (response, status, value) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value));
};

/**
 * 정적 파일 경로를 공개 디렉터리 내부로 제한합니다.
 *
 * @author 정효림
 */
const resolvePublicPath = requestUrl => {
  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIRECTORY, relativePath);
  return filePath.startsWith(`${PUBLIC_DIRECTORY}${path.sep}`) ? filePath : null;
};

const isSafeSessionId = value => typeof value === 'string'
  && /^[a-zA-Z0-9-]{8,100}$/.test(value);

const clearExpiredSessions = () => {
  const expirationTime = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, session] of sessions) {
    if (session.updatedAt < expirationTime) sessions.delete(sessionId);
  }
};

const readJsonBody = async request => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_BODY_LENGTH) throw new Error('요청이 너무 큽니다.');
  }
  return JSON.parse(body);
};

const extractOutputText = data => (data.output || [])
  .flatMap(item => item.content || [])
  .filter(item => item.type === 'output_text')
  .map(item => item.text)
  .join('');

const callOpenAI = async (instructions, input) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions,
        input: `반드시 JSON 객체 형식으로 응답하세요.\n\n${input}`,
        max_output_tokens: 500,
        text: { format: { type: 'json_object' } },
        store: false
      }),
      signal: controller.signal
    });

    const data = await apiResponse.json();
    if (!apiResponse.ok) {
      console.error(
        'OpenAI API 요청 실패:',
        apiResponse.status,
        data.error?.type || 'unknown',
        data.error?.message || '상세 원인 없음'
      );
      throw new Error('OpenAI API 요청에 실패했습니다.');
    }

    const outputText = extractOutputText(data);
    if (!outputText) throw new Error('AI 응답이 비어 있습니다.');
    return JSON.parse(outputText);
  } finally {
    clearTimeout(timeout);
  }
};

const formatConversation = exchanges => exchanges.length
  ? exchanges.map((exchange, index) => [
    `${index + 1}번째 질문: ${exchange.question}`,
    `사용자 답변: ${exchange.answer}`
  ].join('\n')).join('\n\n')
  : '아직 질문과 답변이 없습니다. 상품 종류를 묻는 첫 질문을 만드세요.';

const processAnswerTurn = async (questionNumber, currentQuestion, answer, exchanges) => {
  const result = await callOpenAI(
    ANSWER_TURN_INSTRUCTIONS,
    `현재 질문 번호: 전체 여섯 개 중 ${questionNumber}번째\n현재 질문: ${currentQuestion}\n사용자 답변: ${answer}\n\n이전 대화:\n${formatConversation(exchanges)}`
  );

  const accepted = result.accepted === true;
  const action = result.action === 'change_product' ? 'change_product' : 'answer';
  const reply = typeof result.reply === 'string' ? result.reply.trim() : '';
  const replacementProduct = typeof result.replacementProduct === 'string'
    ? result.replacementProduct.trim()
    : '';
  const nextQuestion = typeof result.nextQuestion === 'string' ? result.nextQuestion.trim() : '';
  const needsNextQuestion = action === 'answer' ? questionNumber < 6 : Boolean(replacementProduct);
  if (accepted && needsNextQuestion && !nextQuestion) {
    throw new Error('AI 다음 질문 형식이 올바르지 않습니다.');
  }
  return { accepted, action, reply, replacementProduct, nextQuestion };
};

const createSummary = async exchanges => {
  const result = await callOpenAI(SUMMARY_INSTRUCTIONS, formatConversation(exchanges));
  const requirements = result.requirements;
  const requiredKeys = ['product', 'budget', 'purpose', 'preferences', 'priority', 'additionalNotes'];

  if (
    typeof result.productName !== 'string'
    || !result.productName.trim()
    || typeof result.summaryText !== 'string'
    || !result.summaryText.trim()
    || !requirements
    || requiredKeys.some(key => typeof requirements[key] !== 'string')
  ) {
    throw new Error('AI 요약 형식이 올바르지 않습니다.');
  }

  return {
    productName: result.productName.trim(),
    summaryText: result.summaryText.trim(),
    requirements: Object.fromEntries(requiredKeys.map(key => [key, requirements[key].trim()]))
  };
};

const createCorrectedSummary = async (summary, correction) => {
  const result = await callOpenAI(
    CORRECTION_INSTRUCTIONS,
    `기존 요청사항:\n${JSON.stringify(summary)}\n\n사용자의 수정 요청:\n${correction}`
  );
  const requirements = result.requirements;
  const requiredKeys = ['product', 'budget', 'purpose', 'preferences', 'priority', 'additionalNotes'];

  if (
    typeof result.productName !== 'string'
    || !result.productName.trim()
    || typeof result.summaryText !== 'string'
    || !result.summaryText.trim()
    || !requirements
    || requiredKeys.some(key => typeof requirements[key] !== 'string')
  ) {
    throw new Error('AI 수정 요약 형식이 올바르지 않습니다.');
  }

  return {
    productName: result.productName.trim(),
    summaryText: result.summaryText.trim(),
    requirements: Object.fromEntries(requiredKeys.map(key => [key, requirements[key].trim()]))
  };
};

const evaluateAnswer = async (question, answer) => {
  const result = await callOpenAI(
    ANSWER_VALIDATION_INSTRUCTIONS,
    `질문: ${question}\n음성 인식 결과: ${answer}`
  );
  return {
    accepted: result.accepted === true,
    reply: typeof result.reply === 'string' ? result.reply.trim() : ''
  };
};

const handleConversation = async (request, response) => {
  if (!OPENAI_API_KEY) {
    sendJson(response, 503, { error: '서버에 OpenAI API 키가 설정되지 않았습니다.' });
    return;
  }

  const body = await readJsonBody(request);
  if (!isSafeSessionId(body.sessionId)) {
    sendJson(response, 400, { error: '대화 세션 정보가 올바르지 않습니다.' });
    return;
  }

  clearExpiredSessions();

  if (body.reset === true) {
    sessions.set(body.sessionId, {
      questionNumber: 1,
      currentQuestion: FIRST_QUESTION,
      exchanges: [],
      completed: false,
      summary: null,
      updatedAt: Date.now(),
      busy: false
    });
    sendJson(response, 200, {
      done: false,
      questionNumber: 1,
      question: FIRST_QUESTION
    });
    return;
  }

  const session = sessions.get(body.sessionId);
  if (!session) {
    sendJson(response, 404, { error: '대화가 만료되었습니다. 질문을 다시 시작해 주세요.' });
    return;
  }
  if (session.busy) {
    sendJson(response, 409, { error: '이전 답변을 처리하고 있습니다.' });
    return;
  }

  const correction = typeof body.correction === 'string' ? body.correction.trim() : '';
  if (correction) {
    if (!session.completed || !session.summary) {
      sendJson(response, 400, { error: '수정할 요청사항이 아직 준비되지 않았습니다.' });
      return;
    }
    if (correction.length > 1000) {
      sendJson(response, 400, { error: '수정 내용이 너무 깁니다.' });
      return;
    }

    session.busy = true;
    try {
      const evaluation = await evaluateAnswer('기존 요청사항에서 어떤 내용을 수정할까요?', correction);
      if (!evaluation.accepted) {
        sendJson(response, 200, {
          done: true,
          repeat: true,
          retryMessage: evaluation.reply || '말씀하신 내용을 수정 요청으로 이해하기 어려웠어요. 수정할 내용을 다시 말씀해 주세요.'
        });
        return;
      }

      const summary = await createCorrectedSummary(session.summary, correction);
      session.summary = summary;
      session.updatedAt = Date.now();
      sendJson(response, 200, {
        done: true,
        corrected: true,
        ...summary
      });
      return;
    } finally {
      session.busy = false;
    }
  }

  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  if (!answer || answer.length > 1000) {
    sendJson(response, 400, { error: '인식된 답변이 없거나 너무 깁니다.' });
    return;
  }

  session.busy = true;
  try {
    const evaluation = await processAnswerTurn(
      session.questionNumber,
      session.currentQuestion,
      answer,
      session.exchanges
    );
    if (!evaluation.accepted) {
      sendJson(response, 200, {
        done: false,
        repeat: true,
        questionNumber: session.questionNumber,
        question: session.currentQuestion,
        retryMessage: evaluation.reply || `말씀하신 내용을 답변으로 이해하기 어려웠어요. ${session.currentQuestion}`
      });
      return;
    }

    if (evaluation.action === 'change_product') {
      session.exchanges = [];
      if (evaluation.replacementProduct) {
        session.exchanges.push({
          question: FIRST_QUESTION,
          answer: evaluation.replacementProduct
        });
        session.questionNumber = 2;
        session.currentQuestion = evaluation.nextQuestion;
      } else {
        session.questionNumber = 1;
        session.currentQuestion = FIRST_QUESTION;
      }
      session.completed = false;
      session.summary = null;
      session.updatedAt = Date.now();
      sendJson(response, 200, {
        done: false,
        restarted: true,
        exchanges: session.exchanges,
        questionNumber: session.questionNumber,
        question: session.currentQuestion
      });
      return;
    }

    session.exchanges.push({ question: session.currentQuestion, answer });
    session.updatedAt = Date.now();

    if (session.questionNumber === 6) {
      const summary = await createSummary(session.exchanges);
      session.completed = true;
      session.summary = summary;
      session.updatedAt = Date.now();
      sendJson(response, 200, {
        done: true,
        exchanges: session.exchanges,
        ...summary
      });
      return;
    }

    const nextQuestionNumber = session.questionNumber + 1;
    session.questionNumber = nextQuestionNumber;
    session.currentQuestion = evaluation.nextQuestion;
    session.updatedAt = Date.now();
    sendJson(response, 200, {
      done: false,
      questionNumber: nextQuestionNumber,
      question: evaluation.nextQuestion
    });
  } finally {
    session.busy = false;
  }
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/api/health') {
      sendJson(response, 200, { ok: true, configured: Boolean(OPENAI_API_KEY) });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/conversation') {
      await handleConversation(request, response);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD, POST' });
      response.end('Method Not Allowed');
      return;
    }

    const filePath = resolvePublicPath(request.url);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('페이지를 찾을 수 없습니다.');
      return;
    }

    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    console.error('서버 요청 처리 실패:', error.name, error.message);
    const message = error.name === 'AbortError'
      ? 'AI 응답 시간이 초과되었습니다. 질문을 다시 시작해 주세요.'
      : 'AI 대화를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    if (!response.headersSent) sendJson(response, 500, { error: message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LightHouse 서버 실행: http://localhost:${PORT}`);
});
