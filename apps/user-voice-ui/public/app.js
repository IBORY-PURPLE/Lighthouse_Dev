const app = document.querySelector('#app');

const STORAGE_KEY = 'lighthouse.requests.v2';
const SPEECH_START_DELAY_MS = 700;
const MICROPHONE_RELEASE_DELAY_MS = 1000;
const RECOGNITION_RELEASE_DELAY_MS = 250;
const SPEECH_CANCEL_RELEASE_DELAY_MS = 150;
const FIRST_QUESTION = '어떤 상품을 찾고 계신가요?';
const DEFAULT_SPEECH_RATE = 0.92;
const SLOW_SPEECH_RATE = 0.72;
const FAST_SPEECH_RATE = 1.12;
const ORDERS = ['첫 번째', '두 번째', '세 번째', '네 번째', '다섯 번째', '여섯 번째'];
const REQUIREMENT_LABELS = {
  product: '요청 상품',
  budget: '예산',
  purpose: '사용 목적',
  preferences: '선호 조건',
  priority: '중요한 점',
  additionalNotes: '기타 요청'
};
const END_COMMANDS = new Set([
  '끝내기', '네끝내기', '끝내기다음', '네끝내기다음', '끝내기할게',
  '그만', '끝', '끝내', '종료', '끝내고싶어요', '그만하고싶어요',
  '끝낼래', '그만할래', '나가고싶어', '나갈래'
]);
const REPEAT_COMMANDS = new Set(['다시', '뭐라고', '다시말해']);
const PAUSE_COMMANDS = new Set(['잠깐', '잠깐만', '잠시만', '멈춰', '정지']);
const NEXT_COMMANDS = new Set(['다음', '다음질문', '넘어가기', '다했어', '다말했어', '이상입니다']);
const CONFIRM_COMMANDS = new Set([
  '네', '보내주세요', '그렇게해주세요', '네보내주세요', '네그렇게해주세요'
]);

const DEMO_REQUESTS = [
  {
    requestId: 'demo-searching-headset',
    productName: '소니 무선 헤드셋',
    status: 'searching',
    requirements: {
      product: '무선 헤드셋',
      budget: '10만 원 이하',
      purpose: '온라인 강의 및 음악 감상',
      preferences: '노이즈 캔슬링 기능',
      priority: '오래 착용해도 편안함',
      additionalNotes: '가벼운 제품 선호'
    },
    volunteerResponse: null
  },
  {
    requestId: 'demo-answered-headset',
    productName: '소니 무선 헤드셋',
    status: 'answered',
    requirements: {
      product: '무선 헤드셋',
      budget: '10만 원 이하',
      purpose: '온라인 강의 및 음악 감상',
      preferences: '노이즈 캔슬링 기능',
      priority: '오래 착용해도 편안함',
      additionalNotes: '가벼운 제품 선호'
    },
    volunteerResponse: {
      price: '59,000원',
      checkedAt: '2026년 11월 20일',
      experience: '봉사자는 소니 무선 헤드셋을 직접 구매해 사용했고, 음악 감상에 만족했다고 전했습니다. 다만 직접 사용한 제품에는 노이즈 캔슬링 기능이 없었습니다.',
      research: '판매 페이지에는 노이즈 캔슬링 기능이 포함된 다른 옵션이 표시되어 있습니다. 이 옵션은 봉사자가 직접 사용해 본 제품은 아닙니다.',
      productUrl: 'https://www.sony.co.kr/headphones'
    }
  }
];

const state = {
  screen: 'home',
  selectedRequestId: null,
  sessionId: '',
  phase: 'intro',
  questionNumber: 0,
  currentQuestion: '',
  exchanges: [],
  summary: null,
  inputMode: 'answer',
  speechRate: DEFAULT_SPEECH_RATE,
  error: '',
  registeredRequestId: null,
  requestsReturnTarget: 'home'
};

let recognition = null;
let speechSequence = 0;
let recognitionSequence = 0;
let requestSequence = 0;
let activeSpeechUtterance = null;
let pendingNextCommand = null;
let pendingGlobalCommand = null;
let pendingRecognitionRetry = false;

/**
 * 사용자 및 AI 문자열을 HTML에 안전하게 표시합니다.
 *
 * @author 정효림
 */
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const speakNotice = (message, onEnd) => {
  if (!('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  activeSpeechUtterance = utterance;
  utterance.lang = 'ko-KR';
  utterance.rate = state.speechRate;
  utterance.volume = 1;
  utterance.onend = () => {
    activeSpeechUtterance = null;
    onEnd?.();
  };
  utterance.onerror = () => {
    activeSpeechUtterance = null;
    onEnd?.();
  };
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);
};

const wait = milliseconds => new Promise(resolve => {
  window.setTimeout(resolve, milliseconds);
});

const focusScreenStart = () => {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      document.querySelector('[data-initial-focus]')?.focus();
    }, 80);
  });
};

const createSessionId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const playStartCue = () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.08, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);
  oscillator.addEventListener('ended', () => context.close());
};

const stopConversationMedia = () => {
  speechSequence += 1;
  recognitionSequence += 1;
  requestSequence += 1;
  pendingNextCommand = null;
  pendingGlobalCommand = null;
  pendingRecognitionRetry = false;
  window.speechSynthesis?.cancel();
  activeSpeechUtterance = null;
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
};

const resetConversation = () => {
  stopConversationMedia();
  state.sessionId = '';
  state.phase = 'intro';
  state.questionNumber = 0;
  state.currentQuestion = '';
  state.exchanges = [];
  state.summary = null;
  state.inputMode = 'answer';
  state.speechRate = DEFAULT_SPEECH_RATE;
  state.error = '';
  state.registeredRequestId = null;
  state.requestsReturnTarget = 'home';
};

const loadSavedRequests = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const getRequests = () => [...loadSavedRequests(), ...DEMO_REQUESTS];
const getSelectedRequest = () => getRequests()
  .find(request => request.requestId === state.selectedRequestId);

const isConversationActive = () => state.screen === 'request'
  && ['permission', 'loading', 'speaking', 'listening', 'processing', 'completing'].includes(state.phase);

const navigate = (screen, requestId = null) => {
  stopConversationMedia();
  state.screen = screen;
  state.selectedRequestId = requestId;
  render();
  focusScreenStart();
};

const renderBackButton = (target, { initialFocus = true } = {}) => `
  <button class="back-button" type="button" data-route="${target}" ${initialFocus ? 'data-initial-focus' : ''}>뒤로 돌아가기</button>
`;

const renderHome = () => `
  <section class="screen" aria-labelledby="home-title">
    <h1 id="home-title" class="home-title sr-only" tabindex="-1" data-screen-title>LightHouse 상품 요청 서비스</h1>
    <p class="lead home-lead">아래의 상품 요청 버튼과 내 구매 요청 목록 버튼 중 선택하실 수 있습니다.</p>
    <div class="choice-list">
      <button class="choice-button" type="button" data-action="new-request" data-initial-focus>
        <span class="choice-name">상품 요청</span>
        <span class="choice-help">원하는 상품을 봉사자에게 요청할 수 있습니다.</span>
      </button>
      <button class="choice-button blue" type="button" data-route="requests">
        <span class="choice-name">내 구매 요청 목록</span>
        <span class="choice-help">요청한 상품의 목록과 봉사자 응답을 확인할 수 있습니다.</span>
      </button>
    </div>
  </section>
`;

const renderConversationHistory = () => state.exchanges.length ? `
  <section class="conversation-history" aria-labelledby="conversation-history-title">
    <h2 id="conversation-history-title">지금까지의 대화</h2>
    <ol>
      ${state.exchanges.map((exchange, index) => `
        <li>
          <p><strong>${ORDERS[index]} 질문:</strong> ${escapeHtml(exchange.question)}</p>
          <p><strong>내 답변:</strong> ${escapeHtml(exchange.answer)}</p>
        </li>
      `).join('')}
    </ol>
  </section>
` : '';

const renderActiveConversation = () => `
  <section class="question-card" aria-labelledby="current-question-title">
    <h2 id="current-question-title" class="question-order">${ORDERS[state.questionNumber - 1]} 질문</h2>
    <p class="question-text">${ORDERS[state.questionNumber - 1]} 질문입니다.<br>${escapeHtml(state.currentQuestion)}</p>
  </section>
  ${renderConversationHistory()}
`;

const renderConversationError = () => `
  <p class="error">${escapeHtml(state.error)}</p>
  <button class="primary-button" type="button" data-action="start-conversation">대화 다시 시작하기</button>
`;

const renderPausedConversation = () => `
  <section class="pause-panel" aria-labelledby="pause-title">
    <h2 id="pause-title">음성 대화 일시 정지</h2>
    <p>대화를 멈췄습니다. 준비가 되면 계속하기를 선택해 주세요.</p>
    <button class="primary-button" type="button" data-action="resume-conversation" data-initial-focus>계속하기</button>
  </section>
`;

const renderSummary = () => `
  <section class="screen" aria-labelledby="summary-screen-title">
    <h1 id="summary-screen-title" class="screen-title" tabindex="-1" data-screen-title>요청사항 확인</h1>
    ${renderBackButton('home', { initialFocus: false })}
    <p class="request-summary" tabindex="-1" data-summary-text data-initial-focus>${escapeHtml(state.summary.summaryText)}</p>
    <div class="button-stack summary-actions">
      <button class="primary-button" type="button" data-action="register-request">이대로 요청하기</button>
      <button class="secondary-button" type="button" data-action="correct-request">요청사항 수정하기</button>
    </div>
  </section>
`;

const renderRequest = () => {
  if (state.phase === 'summary') return renderSummary();

  return `
    <div class="screen ${state.phase === 'intro' ? 'request-intro-screen' : ''}">
      ${renderBackButton('home', { initialFocus: state.phase !== 'paused' })}
      <p class="screen-title" data-screen-title>상품 요청</p>
      <p class="lead">AI가 총 여섯 개의 질문을 합니다. 아래 명령어를 확인한 뒤 시작해 주세요.</p>
      ${state.phase === 'intro' ? `
        <section class="command-guide" aria-labelledby="command-guide-title">
          <h2 id="command-guide-title">지금 말로 쓸 수 있는 명령</h2>
          <p class="command-guide-intro">마이크가 듣는 동안 아래 명령어를 사용할 수 있습니다</p>
          <div class="command-list">
            <article class="command-card">
              <h3>대화 끝내기</h3>
              <p>끝내기 또는 그만 또는 종료라고 말하면 현재 대화를 끝냅니다</p>
            </article>
            <article class="command-card">
              <h3>다음 단계로 이동</h3>
              <p>다음이나 다음 질문 또는 넘어가기라고 말하면 답변을 전달하고 다음 단계로 이동합니다</p>
            </article>
            <article class="command-card">
              <h3>다시 듣기</h3>
              <p>다시 또는 뭐라고 라고 말하면 방금 들은 안내나 질문을 다시 읽습니다</p>
            </article>
            <article class="command-card">
              <h3>말하기 속도 변경</h3>
              <p>천천히 또는 빠르게 또는 보통 속도라고 말하면 AI의 말하기 속도를 바꿉니다</p>
            </article>
            <article class="command-card">
              <h3>대화 잠시 멈추기</h3>
              <p>잠깐 또는 잠시만 또는 멈춰라고 말하면 대화를 일시 정지합니다</p>
            </article>
            <article class="command-card">
              <h3>최종 요청 보내기</h3>
              <p>네 또는 보내주세요 또는 그렇게 해주세요라고 말하면 요청을 접수합니다</p>
            </article>
          </div>
        </section>
        <button class="primary-button" type="button" data-action="start-conversation">음성 요청 시작하기</button>
      ` : state.phase === 'error'
        ? renderConversationError()
        : state.phase === 'paused'
          ? renderPausedConversation()
          : state.questionNumber > 0
            ? renderActiveConversation()
            : ''}
    </div>
  `;
};

const renderRequestCard = request => {
  const answered = request.status === 'answered';
  return `
    <article class="request-card" aria-labelledby="request-${request.requestId}">
      <h2 id="request-${request.requestId}">${escapeHtml(request.productName)}</h2>
      <p class="request-status ${answered ? 'answered' : ''}">${answered ? '봉사자 응답 완료' : '상품 탐색 중'}</p>
      <p class="meta">${answered ? '봉사자가 상품 정보를 정리했습니다.' : '봉사자가 상품을 확인하고 있어요.'}</p>
      <div class="button-stack">
        ${answered ? `<button class="request-action" type="button" data-action="open-response" data-request-id="${request.requestId}">봉사자 응답 확인하기</button>` : ''}
        <button class="request-action" type="button" data-action="open-detail" data-request-id="${request.requestId}">내 요청사항 확인하기</button>
      </div>
    </article>
  `;
};

const renderRequests = () => {
  const requests = getRequests();
  return `
    <section class="screen" aria-labelledby="requests-title">
      <h1 id="requests-title" class="screen-title" tabindex="-1" data-screen-title data-initial-focus>내 구매 요청 목록</h1>
      ${renderBackButton(state.requestsReturnTarget, { initialFocus: false })}
      ${requests.length
        ? `<div class="request-list">${requests.map(renderRequestCard).join('')}</div>`
        : '<p class="empty-state">아직 등록한 상품 요청이 없습니다.</p>'}
    </section>
  `;
};

const renderDetailRows = requirements => Object.entries(REQUIREMENT_LABELS).map(([key, label]) => `
  <div class="detail-row">
    <dt>${label}</dt>
    <dd>${escapeHtml(requirements[key] || '없음')}</dd>
  </div>
`).join('');

const renderDetail = () => {
  const request = getSelectedRequest();
  if (!request) return renderMissing('요청 정보를 찾을 수 없습니다.');
  return `
    <section class="screen" aria-labelledby="detail-title">
      <h1 id="detail-title" class="screen-title" tabindex="-1" data-screen-title>내 요청 사항 확인</h1>
      ${renderBackButton('requests')}
      <article class="detail-card" aria-labelledby="detail-product-title">
        <h2 id="detail-product-title">${escapeHtml(request.productName)}</h2>
        <p>AI와 대화하며 정리한 구매 조건입니다.</p>
        <dl class="detail-list">${renderDetailRows(request.requirements)}</dl>
      </article>
    </section>
  `;
};

const renderResponse = () => {
  const request = getSelectedRequest();
  const response = request?.volunteerResponse;
  if (!request || !response || request.status !== 'answered') {
    return renderMissing('확인 가능한 봉사자 응답이 없습니다.');
  }
  return `
    <section class="screen" aria-labelledby="response-title">
      <h1 id="response-title" class="screen-title" tabindex="-1" data-screen-title data-initial-focus>봉사자 응답 확인</h1>
      ${renderBackButton('requests', { initialFocus: false })}
      <article class="detail-card" aria-labelledby="response-product-title">
        <h2 id="response-product-title">${escapeHtml(request.productName)}</h2>
        ${response.price ? `<p class="price">${escapeHtml(response.price)} · ${escapeHtml(response.checkedAt)} 확인 정보</p>` : ''}
        <section class="review-section" aria-labelledby="experience-title">
          <h3 id="experience-title">봉사자의 직접 사용 경험</h3>
          <p>${escapeHtml(response.experience)}</p>
        </section>
        <section class="review-section" aria-labelledby="research-title">
          <h3 id="research-title">판매 페이지에서 조사한 정보</h3>
          <p>${escapeHtml(response.research)}</p>
        </section>
        <p class="notice">확인 시점: ${escapeHtml(response.checkedAt || '정보 없음')}. 가격, 재고와 상품 옵션은 달라질 수 있습니다.</p>
      </article>
      ${response.productUrl
        ? `<a class="product-link" href="${escapeHtml(response.productUrl)}" target="_blank" rel="noopener noreferrer">해당 상품 링크 바로가기<span class="sr-only">, 새 창 열림</span></a>`
        : '<button class="product-link" type="button" disabled aria-describedby="no-product-link">해당 상품 링크 바로가기</button><p id="no-product-link" class="meta">봉사자가 상품 링크를 제공하지 않았습니다.</p>'}
    </section>
  `;
};

const renderMissing = message => `
  <section class="screen" aria-labelledby="missing-title">
    <h1 id="missing-title" class="screen-title" tabindex="-1" data-screen-title>정보를 찾을 수 없습니다</h1>
    ${renderBackButton('requests')}
    <p class="lead">${escapeHtml(message)}</p>
  </section>
`;

const renderVoiceMotion = () => `
  <div class="voice-session" aria-hidden="true">
    <div class="voice-orb">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </div>
  </div>
`;

const render = () => {
  if (isConversationActive()) {
    document.activeElement?.blur();
    document.body.classList.add('voice-session-active');
    app.setAttribute('aria-hidden', 'true');
    app.setAttribute('inert', '');
    app.innerHTML = renderVoiceMotion();
    document.title = 'AI 음성 대화 | LightHouse';
    return;
  }

  document.body.classList.remove('voice-session-active');
  app.removeAttribute('aria-hidden');
  app.removeAttribute('inert');
  const screens = {
    home: renderHome,
    request: renderRequest,
    requests: renderRequests,
    detail: renderDetail,
    response: renderResponse
  };
  app.innerHTML = (screens[state.screen] || renderHome)();
  document.title = `${document.querySelector('[data-screen-title]')?.textContent || 'LightHouse'} | LightHouse`;
};

const requestConversation = async body => {
  const currentRequestSequence = ++requestSequence;
  const response = await fetch('/api/conversation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, ...body })
  });
  const data = await response.json();
  if (currentRequestSequence !== requestSequence || state.screen !== 'request') return null;
  if (!response.ok) throw new Error(data.error || 'AI 대화 요청에 실패했습니다.');
  return data;
};

const failConversation = message => {
  stopConversationMedia();
  state.phase = 'error';
  state.error = message;
  render();
  speakNotice(message);
};

/**
 * 음성 인식 결과를 명령 비교에 사용할 수 있는 문자열로 정규화합니다.
 *
 * @author 정효림
 */
const normalizeVoiceCommand = value => String(value ?? '')
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]/gu, '')
  .toLowerCase();

const getSpeechRateCommand = command => {
  if (['천천히', '느리게'].includes(command)) {
    return { rate: SLOW_SPEECH_RATE, message: '말하기 속도를 느리게 바꿨습니다.' };
  }
  if (['빠르게', '빨리'].includes(command)) {
    return { rate: FAST_SPEECH_RATE, message: '말하기 속도를 빠르게 바꿨습니다.' };
  }
  if (command === '보통속도') {
    return { rate: DEFAULT_SPEECH_RATE, message: '말하기 속도를 보통으로 바꿨습니다.' };
  }
  return null;
};

const isGlobalVoiceCommand = transcript => {
  const command = normalizeVoiceCommand(transcript);
  return END_COMMANDS.has(command)
    || REPEAT_COMMANDS.has(command)
    || PAUSE_COMMANDS.has(command)
    || Boolean(getSpeechRateCommand(command));
};

const endConversationByVoice = () => {
  stopConversationMedia();
  state.phase = 'completing';
  render();
  speakNotice('음성 대화를 종료하고 처음 화면으로 돌아갑니다.', () => {
    resetConversation();
    navigate('home');
  });
};

const pauseConversation = () => {
  recognitionSequence += 1;
  recognition = null;
  state.phase = 'paused';
  render();
  focusScreenStart();
};

const repeatCurrentPrompt = () => {
  if (state.inputMode === 'confirmation') {
    speakSummaryConfirmation();
    return;
  }
  if (state.inputMode === 'next') {
    speakRetryAndListen(`다음 질문으로 넘어가려면 '다음'이라고 말씀해 주세요.`);
    return;
  }
  if (state.inputMode === 'correction') {
    speakRetryAndListen('수정할 내용을 말씀해 주세요.');
    return;
  }
  speakCurrentQuestion({ immediate: true });
};

/**
 * 모든 대화 단계에서 사용할 수 있는 공통 음성 명령을 처리합니다.
 *
 * @author 정효림
 */
const handleGlobalVoiceCommand = transcript => {
  const command = normalizeVoiceCommand(transcript);
  if (END_COMMANDS.has(command)) {
    endConversationByVoice();
    return true;
  }
  if (REPEAT_COMMANDS.has(command)) {
    repeatCurrentPrompt();
    return true;
  }
  if (PAUSE_COMMANDS.has(command)) {
    pauseConversation();
    return true;
  }

  const speechRateCommand = getSpeechRateCommand(command);
  if (speechRateCommand) {
    state.speechRate = speechRateCommand.rate;
    speakRetryAndListen(speechRateCommand.message);
    return true;
  }
  return false;
};

const speakRetryAndListen = (message = '잘 듣지 못했습니다. 다시 한 번 말씀해 주세요.') => {
  recognitionSequence += 1;
  recognition = null;
  state.phase = 'speaking';
  render();

  if (!('speechSynthesis' in window)) {
    failConversation('음성 안내를 재생하지 못했습니다. 대화를 다시 시작해 주세요.');
    return;
  }

  window.speechSynthesis.cancel();
  const currentSpeechSequence = ++speechSequence;
  const utterance = new SpeechSynthesisUtterance(message);
  activeSpeechUtterance = utterance;
  utterance.lang = 'ko-KR';
  utterance.rate = state.speechRate;
  utterance.volume = 1;
  utterance.onend = () => {
    activeSpeechUtterance = null;
    if (currentSpeechSequence !== speechSequence || state.screen !== 'request') return;
    startRecognition();
  };
  utterance.onerror = () => {
    activeSpeechUtterance = null;
    if (currentSpeechSequence !== speechSequence || state.screen !== 'request') return;
    failConversation('음성 안내를 재생하지 못했습니다. 대화를 다시 시작해 주세요.');
  };
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);
};

const retryCurrentInput = () => {
  if (state.inputMode === 'next') {
    speakRetryAndListen(`아직 '다음'이라는 말을 듣지 못했습니다. 다음 질문으로 넘어가려면 '다음'이라고 말씀해 주세요.`);
    return;
  }
  speakRetryAndListen();
};

const requestMicrophonePermission = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('마이크를 사용할 수 없습니다. HTTPS 주소로 접속했는지 확인해 주세요.');
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    if (['NotAllowedError', 'SecurityError'].includes(error.name)) {
      throw new Error('마이크 사용이 허용되지 않았습니다. Safari 설정에서 마이크를 허용한 뒤 대화를 다시 시작해 주세요.');
    }
    if (error.name === 'NotFoundError') {
      throw new Error('사용할 수 있는 마이크를 찾지 못했습니다. 기기 설정을 확인해 주세요.');
    }
    throw new Error('마이크 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    stream?.getTracks().forEach(track => track.stop());
  }
};

const startRecognition = () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    failConversation('이 브라우저는 음성 인식을 지원하지 않아 대화를 계속할 수 없습니다. 지원되는 브라우저에서 다시 시작해 주세요.');
    return;
  }

  recognition = new Recognition();
  const currentRecognitionSequence = ++recognitionSequence;
  recognition.lang = 'ko-KR';
  recognition.continuous = false;
  recognition.interimResults = false;
  state.phase = 'listening';
  render();
  playStartCue();

  recognition.onresult = event => {
    if (currentRecognitionSequence !== recognitionSequence || state.screen !== 'request') return;
    const result = event.results?.[0];
    const answer = result?.[0]?.transcript?.trim() || '';
    if (!answer) {
      pendingRecognitionRetry = true;
      state.phase = 'processing';
      render();
      return;
    }
    if (isGlobalVoiceCommand(answer)) {
      pendingGlobalCommand = answer;
      state.phase = 'processing';
      render();
      return;
    }
    if (state.inputMode === 'correction') {
      recognition = null;
      submitCorrection(answer);
      return;
    }
    if (state.inputMode === 'confirmation') {
      recognition = null;
      handleSummaryConfirmation(answer);
      return;
    }
    if (state.inputMode === 'next') {
      pendingNextCommand = answer;
      state.phase = 'processing';
      render();
      return;
    }
    recognition = null;
    const parsedAnswer = separateAdvanceCommand(answer);
    submitAnswer(parsedAnswer.answer, { advanceRequested: parsedAnswer.advanceRequested });
  };

  recognition.onerror = event => {
    if (currentRecognitionSequence !== recognitionSequence || state.screen !== 'request') return;
    const permissionDenied = ['not-allowed', 'service-not-allowed'].includes(event.error);
    if (permissionDenied) {
      failConversation('마이크 권한이 허용되지 않았습니다. 브라우저 설정에서 마이크를 허용한 뒤 대화를 다시 시작해 주세요.');
      return;
    }
    pendingRecognitionRetry = true;
    state.phase = 'processing';
    render();
  };

  recognition.onend = () => {
    if (currentRecognitionSequence !== recognitionSequence || state.screen !== 'request') return;
    recognition = null;
    if (pendingGlobalCommand !== null) {
      const command = pendingGlobalCommand;
      pendingGlobalCommand = null;
      window.setTimeout(() => {
        if (currentRecognitionSequence !== recognitionSequence || state.screen !== 'request') return;
        handleGlobalVoiceCommand(command);
      }, RECOGNITION_RELEASE_DELAY_MS);
      return;
    }
    if (pendingNextCommand !== null) {
      const command = pendingNextCommand;
      pendingNextCommand = null;
      window.setTimeout(() => {
        if (currentRecognitionSequence !== recognitionSequence || state.screen !== 'request') return;
        handleNextCommand(command);
      }, RECOGNITION_RELEASE_DELAY_MS);
      return;
    }
    if (pendingRecognitionRetry || state.phase === 'listening') {
      pendingRecognitionRetry = false;
      window.setTimeout(() => {
        if (currentRecognitionSequence !== recognitionSequence || state.screen !== 'request') return;
        retryCurrentInput();
      }, RECOGNITION_RELEASE_DELAY_MS);
    }
  };

  try {
    recognition.start();
  } catch {
    failConversation('음성 인식을 시작하지 못했습니다. 대화를 다시 시작해 주세요.');
  }
};

const handleNextCommand = command => {
  if (!NEXT_COMMANDS.has(normalizeVoiceCommand(command))) {
    speakRetryAndListen(`말씀하신 내용을 다음 명령으로 이해하지 못했어요. 다음 질문으로 넘어가려면 '다음'이라고 말씀해 주세요.`);
    return;
  }

  state.inputMode = 'answer';
  speakCurrentQuestion({ immediate: true });
};

const separateAdvanceCommand = transcript => {
  const match = transcript.match(/\s+(?:그리고\s+)?(?:다음(?:\s*(?:질문|으로))?|넘어가기|다\s*했어|다\s*말했어|이상입니다)[.!?]?\s*$/);
  const answer = match ? transcript.slice(0, match.index).trim() : '';
  if (!answer) {
    return { answer: transcript, advanceRequested: false };
  }
  return { answer, advanceRequested: true };
};

const speakCurrentQuestion = ({ immediate = false } = {}) => {
  if (!('speechSynthesis' in window)) {
    failConversation('이 브라우저는 AI 질문 음성 재생을 지원하지 않습니다.');
    return;
  }

  state.phase = 'speaking';
  state.inputMode = 'answer';
  render();
  const currentSpeechSequence = ++speechSequence;
  const order = ORDERS[state.questionNumber - 1];
  const speechText = `${order} 질문입니다. ${state.currentQuestion}`;

  const startSpeech = () => {
    if (currentSpeechSequence !== speechSequence || state.screen !== 'request') return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    window.setTimeout(() => {
      if (currentSpeechSequence !== speechSequence || state.screen !== 'request') return;
      const utterance = new SpeechSynthesisUtterance(speechText);
      activeSpeechUtterance = utterance;
      utterance.lang = 'ko-KR';
      utterance.rate = state.speechRate;
      utterance.volume = 1;
      utterance.onend = () => {
        activeSpeechUtterance = null;
        if (currentSpeechSequence !== speechSequence || state.screen !== 'request') return;
        startRecognition();
      };
      utterance.onerror = () => {
        activeSpeechUtterance = null;
        if (currentSpeechSequence !== speechSequence || state.screen !== 'request') return;
        failConversation('AI 질문을 재생하지 못했습니다. 대화를 다시 시작해 주세요.');
      };
      window.speechSynthesis.speak(utterance);
    }, SPEECH_CANCEL_RELEASE_DELAY_MS);
  };

  if (immediate) {
    startSpeech();
    return;
  }
  window.setTimeout(startSpeech, SPEECH_START_DELAY_MS);
};

const speakSummaryConfirmation = () => {
  if (!state.summary) return;
  state.inputMode = 'confirmation';
  speakRetryAndListen(
    `여섯 개의 질문이 모두 끝났습니다. 요청 내용을 읽어 드릴게요. ${state.summary.summaryText} 이대로 요청하려면 네, 보내주세요, 또는 그렇게 해주세요라고 말씀해 주세요.`
  );
};

const handleSummaryConfirmation = transcript => {
  if (CONFIRM_COMMANDS.has(normalizeVoiceCommand(transcript))) {
    registerRequest();
    return;
  }

  recognitionSequence += 1;
  state.phase = 'summary';
  render();
  window.requestAnimationFrame(() => {
    document.querySelector('[data-summary-text]')?.focus();
  });
};

const resumeConversation = () => {
  if (state.inputMode === 'confirmation') {
    speakSummaryConfirmation();
    return;
  }
  if (state.inputMode === 'next') {
    speakRetryAndListen(`다음 질문으로 넘어가려면 '다음'이라고 말씀해 주세요.`);
    return;
  }
  if (state.inputMode === 'correction') {
    speakRetryAndListen('수정할 내용을 말씀해 주세요.');
    return;
  }
  speakCurrentQuestion({ immediate: true });
};

const startConversation = () => {
  document.activeElement?.blur();
  resetConversation();
  state.sessionId = createSessionId();
  state.questionNumber = 1;
  state.currentQuestion = FIRST_QUESTION;
  state.phase = 'permission';
  render();

  const sessionPreparation = requestConversation({ reset: true })
    .then(data => ({ data }))
    .catch(error => ({ error }));

  speakNotice(
    `음성 대화를 시작합니다. 각 질문에 답한 뒤 다음 질문으로 넘어가려면 '다음'이라고 말씀해 주세요. 먼저 마이크 사용을 허용해 주세요.`,
    async () => {
      try {
        await requestMicrophonePermission();
        const result = await sessionPreparation;
        if (result.error) throw result.error;
        if (!result.data) throw new Error('AI 대화를 준비하지 못했습니다. 다시 시작해 주세요.');
        state.questionNumber = result.data.questionNumber;
        state.currentQuestion = result.data.question;
        await wait(MICROPHONE_RELEASE_DELAY_MS);
        if (state.screen !== 'request' || state.phase !== 'permission') return;
        window.speechSynthesis.resume();
        speakCurrentQuestion({ immediate: true });
      } catch (error) {
        failConversation(error.message || '음성 대화를 시작하지 못했습니다. 다시 시도해 주세요.');
      }
    }
  );
};

const submitAnswer = async (answer, { advanceRequested = false } = {}) => {
  state.phase = 'processing';
  render();

  const answeredQuestion = state.currentQuestion;
  try {
    const data = await requestConversation({ answer });
    if (!data) return;

    if (data.repeat) {
      speakRetryAndListen(data.retryMessage);
      return;
    }

    if (data.restarted) {
      state.exchanges = data.exchanges || [];
    } else {
      state.exchanges.push({ question: answeredQuestion, answer });
    }

    if (data.done) {
      state.exchanges = data.exchanges;
      state.summary = {
        productName: data.productName,
        summaryText: data.summaryText,
        requirements: data.requirements
      };
      speakSummaryConfirmation();
      return;
    }

    state.questionNumber = data.questionNumber;
    state.currentQuestion = data.question;
    if (advanceRequested) {
      state.inputMode = 'answer';
      speakCurrentQuestion({ immediate: true });
      return;
    }
    state.inputMode = 'next';
    speakRetryAndListen(`다음 질문으로 넘어가려면 '다음'이라고 말씀해 주세요.`);
  } catch (error) {
    failConversation(error.message);
  }
};

const startCorrection = () => {
  state.inputMode = 'correction';
  speakRetryAndListen('수정할 내용을 말씀해 주세요.');
};

const submitCorrection = async correction => {
  state.phase = 'processing';
  render();

  try {
    const data = await requestConversation({ correction });
    if (!data) return;

    if (data.repeat) {
      speakRetryAndListen(data.retryMessage);
      return;
    }

    state.summary = {
      productName: data.productName,
      summaryText: data.summaryText,
      requirements: data.requirements
    };
    state.phase = 'completing';
    render();
    speakNotice(
      '요청사항을 수정했습니다. 다시 확인해 주세요.',
      () => {
        if (state.phase !== 'completing' || state.screen !== 'request') return;
        state.phase = 'summary';
        render();
        window.requestAnimationFrame(() => {
          document.querySelector('[data-summary-text]')?.focus();
        });
      }
    );
  } catch (error) {
    failConversation(error.message);
  }
};

const registerRequest = () => {
  if (!state.summary) return;
  const requestId = state.registeredRequestId || `req-${Date.now()}`;
  const request = {
    requestId,
    productName: state.summary.productName,
    status: 'searching',
    requirements: state.summary.requirements,
    answers: state.exchanges.map((exchange, index) => ({
      questionNumber: index + 1,
      question: exchange.question,
      answer: exchange.answer
    })),
    volunteerResponse: null
  };

  try {
    const savedRequests = loadSavedRequests();
    const requestsWithoutCurrent = savedRequests
      .filter(savedRequest => savedRequest.requestId !== requestId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([request, ...requestsWithoutCurrent]));
    state.registeredRequestId = requestId;
    state.requestsReturnTarget = 'request';
    state.phase = 'summary';
    navigate('requests');
  } catch {
    failConversation('상품 요청을 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.');
  }
};

app.addEventListener('click', event => {
  const control = event.target.closest('[data-route], [data-action]');
  if (!control) return;

  if (control.dataset.route) {
    if (state.screen === 'request' && !['intro', 'summary', 'error'].includes(state.phase)) {
      const shouldLeave = window.confirm('진행 중인 AI 대화를 종료하고 이동할까요?');
      if (!shouldLeave) return;
      resetConversation();
    }
    if (control.dataset.route === 'requests' && state.screen === 'home') {
      state.requestsReturnTarget = 'home';
    }
    navigate(control.dataset.route);
    return;
  }

  const action = control.dataset.action;
  if (action === 'new-request') {
    resetConversation();
    navigate('request');
  } else if (action === 'start-conversation') {
    startConversation();
  } else if (action === 'resume-conversation') {
    resumeConversation();
  } else if (action === 'register-request') {
    registerRequest();
  } else if (action === 'correct-request') {
    startCorrection();
  } else if (action === 'open-detail') {
    navigate('detail', control.dataset.requestId);
  } else if (action === 'open-response') {
    navigate('response', control.dataset.requestId);
  }
});

window.addEventListener('beforeunload', stopConversationMedia);

render();
focusScreenStart();
