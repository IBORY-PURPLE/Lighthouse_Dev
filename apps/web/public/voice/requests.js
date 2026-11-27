const byId = (id) => document.getElementById(id);
const requestList = byId('requests');
const listStatus = byId('list-live');
const empty = byId('requests-empty');
const pushButton = byId('push-btn');
const listLimit = 20;
const listKey = 'lh-requests';

const screens = {
  home: '홈',
  list: '구매 요청 목록',
  details: '내 요청 사항 확인',
  review: '봉사자 응답 확인',
};

const statuses = {
  sending: ['요청 접수 중', '접수가 끝나면 이 목록에서 확인할 수 있어요.'],
  waiting: ['봉사자 매칭 대기', '요청이 등록되었고 봉사자가 맡기를 기다리고 있어요.'],
  in_progress: ['상품 탐색 중', '봉사자가 요청을 맡아 상품을 찾고 있어요.'],
  done: ['봉사자 응답 완료', '봉사자가 상품 정보를 정리했습니다.'],
  expired: ['요청 만료', '요청 시간이 지났어요.'],
  unknown: ['이전 기록', '이전 요청이라 진행 상황을 확인할 수 없어요.'],
};

function loadRequests(fallback = []) {
  try {
    const value = JSON.parse(localStorage.getItem(listKey) || '[]');
    return Array.isArray(value)
      ? value.filter(item => item && typeof item.product === 'string').slice(0, listLimit)
      : [];
  } catch {
    return fallback;
  }
}

let items = loadRequests();
let listState = 'loading';
let activeScreen = 'home';
let refreshTimer;
let refreshing;
let viewSequence = 0;
let returnFocus;

function statusOf(item) {
  if (!item.requestId) return item.cid ? 'sending' : 'unknown';
  return Object.hasOwn(statuses, item.status) ? item.status : 'waiting';
}

function node(tag, className, label) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (label) element.textContent = label;
  return element;
}

function requestButton(item, label, open, heading, index) {
  const button = node('button', 'request-action', label);
  button.type = 'button';
  button.dataset.focusKey = (item.requestId || item.cid || index) + ':' + label;
  button.setAttribute('aria-describedby', heading);
  button.addEventListener('click', () => {
    returnFocus = button.dataset.focusKey;
    open(item);
  });
  return button;
}

function focusAction(key) {
  const target = [...requestList.querySelectorAll('[data-focus-key]')]
    .find(button => button.dataset.focusKey === key);
  if (target) target.focus({ preventScroll: true });
  return Boolean(target);
}

function renderRequests() {
  const focused = document.activeElement?.dataset.focusKey;
  const cards = items.map((item, index) => {
    const status = statusOf(item);
    const [label, description] = statuses[status];
    const card = node('article', 'request-card');
    const title = node('h2', '', item.product);
    title.id = 'request-product-' + index;
    card.setAttribute('aria-labelledby', title.id);
    const badge = node('p', 'request-status', label);
    badge.dataset.status = status;
    const actions = node('div', 'request-actions');
    if (status === 'done') {
      actions.append(requestButton(item, '봉사자 응답 확인하기', openReview, title.id, index));
    }
    actions.append(requestButton(item, '내 요청사항 확인하기', openDetails, title.id, index));
    card.append(title, badge, node('p', 'request-meta', description), actions);
    return card;
  });
  requestList.replaceChildren(...cards);
  empty.hidden = items.length !== 0;
  empty.textContent = {
    loading: '구매 요청을 불러오는 중이에요.',
    failed: '구매 요청을 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.',
    ready: '아직 등록한 상품 요청이 없습니다.',
  }[listState];
  renderPushButton();
  if (focused && !focusAction(focused)) byId('list-title').focus();
}

function show(screen, focusId = screen + '-title') {
  viewSequence += 1;
  clearInterval(refreshTimer);
  window.speechSynthesis?.cancel();
  const previous = byId(activeScreen);
  previous.hidden = true;
  previous.classList.remove('active');
  if (activeScreen === 'details' && screen !== 'details') byId('details-facts').replaceChildren();
  const next = byId(screen);
  next.hidden = false;
  next.classList.add('active');
  activeScreen = screen;
  document.title = 'LightHouse · ' + screens[screen];
  if (screen !== 'list') {
    byId(focusId).focus();
    return;
  }

  renderRequests();
  if (!returnFocus || !focusAction(returnFocus)) byId(focusId).focus();
  returnFocus = undefined;
  refreshTimer = setInterval(refreshRequests, 15000);
  return refreshRequests();
}

function requestUrl(id) {
  return '/api/requests/' + encodeURIComponent(id);
}

function updateItem(old, row) {
  const item = {
    ...old,
    requestId: row.requestId || old.requestId,
    product: row.product || old.product,
    status: row.status || old.status,
    queueNumber: row.queueNumber ?? old.queueNumber,
    createdAt: row.createdAt ?? old.createdAt,
  };
  if (item.status === 'done') {
    item.review = row.review ?? old.review;
    item.sentAt = row.sentAt ?? old.sentAt;
  } else {
    delete item.review;
    delete item.sentAt;
  }
  return item;
}

async function checkSavedRequest(id) {
  try {
    const response = await fetch(requestUrl(id), { cache: 'no-store' });
    if (response.status === 400) return null;
    if (response.status === 404) {
      const body = await response.json();
      return body.persistent === false ? undefined : null;
    }
    if (response.ok) return await response.json();
  } catch { /* 연결이 끊긴 동안에는 기기 기록을 유지한다. */ }
}

function announceChanges(previous, next) {
  const known = new Map(previous.map(item => [item.requestId, item]));
  const messages = next.flatMap(item => {
    const old = known.get(item.requestId);
    if (!item.requestId || !old || item.status === old.status) return [];
    const change = {
      in_progress: '봉사자가 요청을 맡았어요.',
      done: '리뷰가 도착했어요.',
      expired: '요청 시간이 지났어요.',
    }[item.status];
    return change ? [item.product + ' ' + change] : [];
  });
  if (messages.length) listStatus.textContent = messages.join(' ');
}

async function syncRequests() {
  const knownAtStart = new Set(loadRequests(items).map(item => item.requestId));
  let response;
  try {
    const result = await fetch('/api/requests', { cache: 'no-store' });
    if (result.ok) response = await result.json();
  } catch { /* 기기 기록으로 계속 보여 준다. */ }
  if (!Array.isArray(response?.items)) {
    listState = 'failed';
    if (activeScreen === 'list' && items.length === 0) renderRequests();
    return;
  }

  const serverIds = new Set(response.items.map(row => row.requestId));
  const missing = loadRequests(items).filter(item => item.requestId && !serverIds.has(item.requestId));
  const checked = new Map(response.complete === true
    ? await Promise.all(missing.map(async item => [item.requestId, await checkSavedRequest(item.requestId)]))
    : []);
  // 기다리는 동안 다른 탭에서 접수했을 수 있어, 마지막에 기기 기록을 다시 읽는다.
  const previous = items;
  const local = loadRequests(items);
  const cached = new Map(local.filter(item => item.requestId).map(item => [item.requestId, item]));
  const synced = response.items.map(row => updateItem(cached.get(row.requestId) || {}, row));
  const kept = local.filter(item => item.requestId && !serverIds.has(item.requestId)).flatMap(item => {
    const row = checked.get(item.requestId);
    if (row === null && knownAtStart.has(item.requestId)) return [];
    return [row ? updateItem(item, row) : item];
  });
  const sending = local.filter(item => !item.requestId && item.cid);
  const legacy = local.filter(item => !item.requestId && !item.cid);
  const newestListedAt = Date.parse(synced[0]?.createdAt ?? '');
  const newestListedNumber = synced[0]?.queueNumber ?? 0;
  const newer = [];
  const older = [];
  for (const item of kept) {
    const time = Date.parse(item.createdAt ?? '');
    const hasServerTime = Number.isFinite(time) && Number.isFinite(newestListedAt);
    const isNewer = (!checked.get(item.requestId) && !knownAtStart.has(item.requestId))
      || (hasServerTime && (time > newestListedAt || (time === newestListedAt && item.queueNumber > newestListedNumber)));
    (isNewer ? newer : older).push(item);
  }
  // 이전 서버 응답이 20건을 채워도, 그 응답보다 늦게 접수한 요청부터 보존한다.
  const next = [...sending, ...newer, ...synced, ...older, ...legacy].slice(0, listLimit);
  const shouldRender = listState !== 'ready' || JSON.stringify(previous) !== JSON.stringify(next);
  listState = 'ready';
  if (!shouldRender) return;

  items = next;
  try { localStorage.setItem(listKey, JSON.stringify(items)); } catch { /* 현재 화면에는 계속 남긴다. */ }
  if (activeScreen === 'list') {
    renderRequests();
    announceChanges(previous, items);
  }
}

function refreshRequests() {
  refreshing ??= syncRequests().finally(() => { refreshing = undefined; });
  return refreshing;
}

function renderFacts(target, rows) {
  target.replaceChildren(...rows.filter(([, value]) => value).map(([label, value]) => {
    const row = node('div', 'request-fact');
    row.append(node('dt', '', label), node('dd', '', value));
    return row;
  }));
}

async function loadView(item) {
  if (!item.requestId) return null;
  try {
    const response = await fetch(requestUrl(item.requestId) + '?view=details', { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function renderDetails(item, view) {
  const status = statusOf(view || item);
  byId('details-product').textContent = item.product;
  byId('details-status').textContent = statuses[status][0];
  byId('details-status').dataset.status = status;
  byId('details-message').textContent = statuses[status][1];
  const aliases = { '원하는 제품': '요청 상품', '원하는 옵션': '선호 조건' };
  const facts = new Map([
    ['요청 상품', item.product],
    ['예산', view?.buyer?.budget],
    ['상품 상태 조건', view?.buyer?.condition],
    ['접수 번호', (view?.queueNumber ?? item.queueNumber) ? (view?.queueNumber ?? item.queueNumber) + '번' : ''],
  ]);
  for (const { q, a } of view?.details?.qa ?? []) {
    const label = Object.hasOwn(aliases, q) ? aliases[q] : q;
    if (!facts.get(label)) facts.set(label, a);
  }
  const summary = view?.details?.summary || item.summary;
  if (summary && ![...facts.values()].includes(summary)) facts.set('요청 요약', summary);
  renderFacts(byId('details-facts'), [...facts]);
}

async function openDetails(item) {
  renderDetails(item);
  show('details');
  const displayed = viewSequence;
  const view = await loadView(item);
  if (view && viewSequence === displayed) renderDetails(item, view);
}

const sentDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'Asia/Seoul' });

function renderReview(item, view) {
  byId('review-product').textContent = item.product;
  byId('review-text').textContent = view?.review || item.review || '리뷰를 아직 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.';
  const info = view?.buyer?.reviewInfo;
  const date = Date.parse(view?.sentAt ?? item.sentAt ?? '');
  const meta = [
    Number.isFinite(date) ? '리뷰 도착 ' + sentDate.format(date) : '',
    info?.purchase,
  ].filter(Boolean).join(' · ');
  byId('review-meta').textContent = meta;
  byId('review-meta').hidden = !meta;
  byId('review-experience').hidden = !info?.experience;
  byId('review-experience-text').textContent = info?.experience || '';

  const research = (info?.research ?? []).map(({ label, value }) => [label, value]);
  if (info?.model) research.unshift(['추천 기종', info.model]);
  renderFacts(byId('review-research-facts'), research);
  byId('review-research').hidden = research.length === 0;
  const links = (info?.sources ?? []).flatMap(({ label, url }) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return [];
    const link = node('a', 'request-action review-link', label + ' 열기');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(node('span', 'sr-only', ', 새 창 열림'));
    return [link];
  });
  byId('review-links').replaceChildren(...links);
  byId('review-notice').hidden = links.length === 0;
}

async function openReview(item) {
  renderReview(item);
  show('review', 'review-text');
  const displayed = viewSequence;
  const view = await loadView(item);
  if (view && viewSequence === displayed) renderReview(item, view);
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function renderPushButton() {
  let enabled = false;
  try {
    enabled = pushSupported() && Notification.permission === 'granted' && localStorage.getItem('lh-push') === 'on';
  } catch { /* 기록이 없을 때는 기본 문구를 보여 준다. */ }
  pushButton.textContent = enabled ? '리뷰가 오면 알림으로 알려 드려요' : '리뷰가 오면 알림 받기';
}

function pushTell(message) {
  listStatus.textContent = message;
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'ko-KR';
  window.speechSynthesis.speak(utterance);
}

async function enablePush() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) {
    pushTell('알림을 받으려면 Safari에서 홈 화면에 추가한 뒤 Lighthouse 아이콘으로 열어 주세요.');
    return;
  }
  if (!pushSupported()) {
    pushTell('이 브라우저는 알림을 지원하지 않아요. 목록에서 진행 상황을 확인할 수 있어요.');
    return;
  }

  try {
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') {
      pushTell('알림이 꺼져 있어요. 설정에서 Lighthouse 알림을 켜 주세요.');
      return;
    }
    const keyResponse = await fetch('/api/push/key', { cache: 'no-store' });
    const { publicKey } = keyResponse.ok ? await keyResponse.json() : {};
    if (!publicKey) throw new Error('Push key unavailable');
    const registration = await navigator.serviceWorker.register('/sw.js');
    const key = publicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(publicKey.length / 4) * 4, '=');
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(atob(key), character => character.charCodeAt(0)),
    });

    const active = items.filter(item => item.requestId && (item.status === 'waiting' || item.status === 'in_progress'));
    const results = await Promise.allSettled(active.map(item => fetch(requestUrl(item.requestId) + '/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    })));
    try { localStorage.setItem('lh-push', 'on'); } catch { /* 이번 구독은 계속 유효하다. */ }
    renderPushButton();
    if (results.some(result => result.status !== 'fulfilled' || !result.value.ok)) {
      pushTell('일부 요청에 알림을 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.');
    } else {
      pushTell('리뷰가 도착하면 알림으로 알려 드릴게요.');
    }
  } catch {
    pushTell('알림 준비에 실패했어요. 잠시 뒤 다시 눌러 주세요.');
  }
}

async function openFromLink() {
  const id = new URLSearchParams(location.search).get('request');
  if (!id) return;
  const opened = show('list');
  const displayed = viewSequence;
  await opened;
  if (viewSequence !== displayed) return;
  const item = items.find(request => request.requestId === id);
  if (item?.status === 'done' && item.review) openReview(item);
}

for (const button of document.querySelectorAll('[data-screen]')) {
  button.addEventListener('click', () => show(button.dataset.screen));
}
pushButton.addEventListener('click', enablePush);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
void openFromLink();
