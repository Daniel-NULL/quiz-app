/* Quiz Assistant · 通用交互式刷题器 */
'use strict';

const BANKS_INDEX_URL = './banks/index.json?v=20261008';
const STORAGE_PREFIX = 'quizProgress_v2:';
/* 题目纠错反馈：指向本仓库的 Issues 新建页（部署后可用） */
const GITHUB_ISSUES_NEW_URL = 'https://github.com/Daniel-NULL/quiz-app/issues/new';

const $ = (id) => document.getElementById(id);

const TYPE_LABELS = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  blank: '填空题',
};

function typeLabel(t) {
  return TYPE_LABELS[t] || t || '';
}

function normalizeText(s) {
  return String(s ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sortLetters(s) {
  return String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .sort()
    .join('');
}

/* ---------- 存储（localStorage 主备双写，降低进度丢失风险） ---------- */

function storageKeys(bankId) {
  const base = `${STORAGE_PREFIX}${bankId}`;
  return { primary: base, backup: `${base}__backup` };
}

function tryParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function loadState(bankId) {
  const { primary, backup } = storageKeys(bankId);
  const p = tryParse(localStorage.getItem(primary));
  if (p) return p;
  const b = tryParse(localStorage.getItem(backup));
  if (b) {
    try {
      localStorage.setItem(primary, JSON.stringify(b));
    } catch {
      /* ignore */
    }
  }
  return b;
}

function saveState(bankId, state) {
  const payload = JSON.stringify(state);
  const { primary, backup } = storageKeys(bankId);
  try {
    localStorage.setItem(primary, payload);
  } catch (e) {
    console.warn('写进度失败', e);
  }
  try {
    localStorage.setItem(backup, payload);
  } catch (e) {
    console.warn('写备份失败', e);
  }
}

function makeInitialState(questionIds) {
  return {
    version: 1,
    mode: 'all',
    currentIndexAll: 0,
    currentIndexWrong: 0,
    questionIds,
    answers: {},
  };
}

function isValidState(state) {
  return !!(
    state &&
    typeof state === 'object' &&
    state.version === 1 &&
    Array.isArray(state.questionIds) &&
    state.answers &&
    typeof state.answers === 'object'
  );
}

/* ---------- 状态统计 ---------- */

function computeStats(state) {
  const entries = Object.values(state.answers || {});
  const answered = entries.length;
  const correct = entries.filter((e) => e.correct).length;
  const wrong = entries.filter((e) => e.correct === false).length;
  return { answered, correct, wrong };
}

function buildWrongIds(state) {
  const wrong = [];
  for (const qid of state.questionIds) {
    const rec = state.answers?.[qid];
    if (rec && rec.correct === false) wrong.push(qid);
  }
  return wrong;
}

function getActiveIds(state) {
  return state.mode === 'wrong' ? buildWrongIds(state) : state.questionIds;
}

function getActiveIndex(state) {
  return state.mode === 'wrong' ? state.currentIndexWrong : state.currentIndexAll;
}

function setActiveIndex(state, idx) {
  if (state.mode === 'wrong') state.currentIndexWrong = idx;
  else state.currentIndexAll = idx;
}

function setMode(state, mode) {
  state.mode = mode;
}

/* ---------- 渲染 ---------- */

function renderProgress(meta, state) {
  const { answered, correct, wrong } = computeStats(state);
  const total = state.questionIds.length;

  $('meta').textContent = meta?.source ? `题库：${meta.source}（共 ${total} 题）` : `共 ${total} 题`;

  const pct = total === 0 ? 0 : Math.round((answered / total) * 100);
  $('progressText').innerHTML = `进度：已答 <b>${answered}/${total}</b>（正确 <span class="good-num">${correct}</span>，错误 <span class="bad-num">${wrong}</span>）`;
  $('progressFill').style.width = `${pct}%`;

  const wrongCount = buildWrongIds(state).length;
  const modeBtn = $('toggleModeBtn');
  modeBtn.innerHTML = '';
  const modeSpan = document.createElement('span');
  modeSpan.textContent = state.mode === 'wrong' ? '返回练习' : '错题回顾';
  modeBtn.appendChild(modeSpan);
  if (state.mode !== 'wrong' && wrongCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = wrongCount;
    modeBtn.appendChild(badge);
  }

  const banner = $('modeBanner');
  if (state.mode === 'wrong') {
    banner.hidden = false;
    banner.textContent = `错题回顾模式：共 ${wrongCount} 道错题`;
  } else {
    banner.hidden = true;
    banner.textContent = '';
  }
}

function renderEmpty(message) {
  $('questionArea').hidden = true;
  const empty = $('emptyState');
  empty.hidden = false;
  empty.textContent = message;
  $('feedbackBtn').hidden = true;
  $('prevBtn').hidden = true;
}

function showResult(q, saved) {
  const resultEl = $('result');
  const ok = saved.correct === true;
  resultEl.hidden = false;
  resultEl.className = 'result ' + (ok ? 'good' : 'bad');
  resultEl.innerHTML = '';

  const icon = document.createElement('div');
  icon.className = 'res-icon';
  icon.textContent = ok ? '✓' : '✕';

  const body = document.createElement('div');
  body.className = 'res-body';

  const title = document.createElement('div');
  title.className = 'res-title';
  title.textContent = ok ? '回答正确' : '回答错误';

  const detail = document.createElement('div');
  detail.className = 'res-detail';
  const parts = [];
  if (q.type === 'multiple') {
    parts.push(`正确答案：${sortLetters(q.answer) || '（未知）'}`);
  } else {
    parts.push(`正确答案：${normalizeText(q.answer) || '（未知）'}`);
  }
  if (q.explanation) parts.push(`答案解释：${q.explanation}`);
  detail.textContent = parts.join('\n');

  body.appendChild(title);
  body.appendChild(detail);
  resultEl.appendChild(icon);
  resultEl.appendChild(body);
}

function lockInputs(locked) {
  for (const el of document.querySelectorAll('#answerForm input')) {
    el.disabled = locked;
  }
}

function renderQuestion(questionsById, state, bank) {
  const activeIds = getActiveIds(state);
  const idx = getActiveIndex(state);

  if (activeIds.length === 0) {
    renderEmpty(state.mode === 'wrong' ? '暂无错题。先正常刷题，答错的会自动进入错题集。' : '题库为空。');
    return;
  }

  if (idx < 0 || idx >= activeIds.length) setActiveIndex(state, 0);

  const qid = activeIds[getActiveIndex(state)];
  const q = questionsById[qid];
  if (!q) {
    renderEmpty('题目加载异常：找不到题目。');
    return;
  }

  $('feedbackBtn').hidden = false;
  $('emptyState').hidden = true;
  $('questionArea').hidden = false;

  /* 上一题按钮：显示于进度行右侧；第一题（或错题模式第一道错题）时禁用 */
  $('prevBtn').hidden = false;
  $('prevBtn').disabled = getActiveIndex(state) === 0;

  /* 红色垃圾桶：仅错题回顾模式显示（标为已会，移出错题集） */
  $('forgiveBtn').hidden = state.mode !== 'wrong';

  $('qIndex').textContent =
    state.mode === 'wrong'
      ? `错题 ${getActiveIndex(state) + 1}/${activeIds.length}`
      : `第 ${getActiveIndex(state) + 1}/${activeIds.length} 题`;
  $('qType').textContent = typeLabel(q.type);
  $('qStem').textContent = q.stem;

  const optionsEl = $('options');
  optionsEl.innerHTML = '';

  const blankWrap = $('blankInput');
  blankWrap.hidden = q.type !== 'blank';
  $('blankText').value = '';

  const saved = state.answers?.[qid] ?? null;
  const submitBtn = $('submitBtn');
  submitBtn.hidden = true;
  submitBtn.disabled = true;

  if (q.type !== 'blank') {
    const isMulti = q.type === 'multiple';
    const inputType = isMulti ? 'checkbox' : 'radio';
    const name = `q_${qid}`;
    const showSubmit = isMulti && !saved;
    submitBtn.hidden = !showSubmit;

    const labels = Object.keys(q.options || {});
    labels.sort();

    for (const label of labels) {
      const option = document.createElement('label');
      option.className = 'option';

      const input = document.createElement('input');
      input.type = inputType;
      input.name = name;
      input.value = label;

      const mark = document.createElement('div');
      mark.className = 'mark';

      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = `${label}.`;

      const t = document.createElement('div');
      t.className = 'text';
      t.textContent = q.options[label];

      option.appendChild(input);
      option.appendChild(mark);
      option.appendChild(l);
      option.appendChild(t);
      optionsEl.appendChild(option);
    }

    if (saved) {
      const resp = saved.response;
      const selected = Array.isArray(resp) ? resp : [resp];
      for (const input of optionsEl.querySelectorAll('input')) {
        if (selected.includes(input.value)) input.checked = true;
      }
    }

    if (labels.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty';
      hint.textContent = '该题未解析到可选项（可能是 PDF 排版导致），可直接点“下一题”。';
      optionsEl.appendChild(hint);
    }
  } else {
    if (saved) $('blankText').value = saved.response || '';
  }

  const resultEl = $('result');
  resultEl.hidden = true;
  resultEl.className = 'result';
  resultEl.textContent = '';

  if (saved) {
    $('nextBtn').disabled = false;
    lockInputs(true);
    showResult(q, saved);

    /* 选项对错标记：正确项绿色、错选红色、其余变暗 */
    const correctLetters = String(q.answer || '').toUpperCase().replace(/[^A-H]/g, '').split('');
    const chosen = Array.isArray(saved.response)
      ? saved.response.map((x) => String(x).toUpperCase())
      : [String(saved.response ?? '').toUpperCase()];
    for (const opt of optionsEl.querySelectorAll('.option')) {
      const val = opt.querySelector('input').value.toUpperCase();
      opt.classList.add('locked');
      if (correctLetters.includes(val)) {
        opt.classList.add('correct');
      } else if (chosen.includes(val)) {
        opt.classList.add('wrong');
      }
    }
  } else {
    $('nextBtn').disabled = true;
    lockInputs(false);
  }
}

/* ---------- 答题判分 ---------- */

function collectResponse(q) {
  if (q.type === 'blank') return $('blankText').value;
  const selected = Array.from(document.querySelectorAll('#options input:checked')).map((i) => i.value);
  if (q.type === 'multiple') return selected;
  return selected[0] || '';
}

function grade(q, response) {
  if (!q.answer) return false;
  if (q.type === 'multiple') {
    const r = Array.isArray(response) ? response.join('') : String(response ?? '');
    return sortLetters(r) === sortLetters(q.answer);
  }
  if (q.type === 'blank') {
    return normalizeText(response) === normalizeText(q.answer);
  }
  return String(response ?? '').trim().toUpperCase() === String(q.answer ?? '').trim().toUpperCase();
}

function scrollToTop() {
  setTimeout(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 0);
}

function scrollResultIntoView() {
  setTimeout(() => {
    const el = $('result');
    if (el && !el.hidden) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
}

/* ---------- 进度导出 / 导入（跨设备同步） ---------- */

function getAllSavedBankStates() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX) || key.endsWith('__backup')) continue;
      const bankId = key.slice(STORAGE_PREFIX.length);
      const st = loadState(bankId);
      if (st) out[bankId] = st;
    }
  } catch (e) {
    console.warn('枚举进度失败', e);
  }
  return out;
}

function mergeAnswerRecord(existingRec, incomingRec) {
  if (!existingRec) return incomingRec;
  if (!incomingRec) return existingRec;
  const exWrong = existingRec.correct === false;
  const inWrong = incomingRec.correct === false;
  if (exWrong || inWrong) {
    const chosen = exWrong ? existingRec : incomingRec;
    return {
      response: chosen.response,
      correct: false,
      ts: Math.max(Number(existingRec.ts || 0), Number(incomingRec.ts || 0)) || Date.now(),
    };
  }
  const exTs = Number(existingRec.ts || 0);
  const inTs = Number(incomingRec.ts || 0);
  return inTs >= exTs ? incomingRec : existingRec;
}

function mergeStates(existingState, incomingState) {
  if (!isValidState(existingState)) return incomingState;
  if (!isValidState(incomingState)) return existingState;

  const mergedQuestionIds = Array.isArray(existingState.questionIds) ? [...existingState.questionIds] : [];
  const seen = new Set(mergedQuestionIds);
  for (const qid of incomingState.questionIds || []) {
    if (!seen.has(qid)) {
      mergedQuestionIds.push(qid);
      seen.add(qid);
    }
  }

  const mergedAnswers = { ...(existingState.answers || {}) };
  for (const [qid, inRec] of Object.entries(incomingState.answers || {})) {
    mergedAnswers[qid] = mergeAnswerRecord(mergedAnswers[qid], inRec);
  }

  return {
    version: 1,
    mode: existingState.mode || incomingState.mode || 'all',
    currentIndexAll: Number.isFinite(existingState.currentIndexAll) ? existingState.currentIndexAll : (incomingState.currentIndexAll || 0),
    currentIndexWrong: Number.isFinite(existingState.currentIndexWrong) ? existingState.currentIndexWrong : (incomingState.currentIndexWrong || 0),
    questionIds: mergedQuestionIds,
    answers: mergedAnswers,
  };
}

async function copyText(text) {
  const s = String(text ?? '');
  if (!s) return false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(s);
      return true;
    } catch {
      /* fallthrough */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function buildExportPayload(banks) {
  const statesByBankId = getAllSavedBankStates();
  const namesById = {};
  for (const b of banks) namesById[b.id] = b.name;

  const payload = {
    schema: 'quiz-progress-export',
    schemaVersion: 1,
    exportedAt: Date.now(),
    storagePrefix: STORAGE_PREFIX,
    banks: {},
  };

  for (const [bankId, st] of Object.entries(statesByBankId)) {
    if (!isValidState(st)) continue;
    payload.banks[bankId] = { name: namesById[bankId] || '', state: st };
  }
  return payload;
}

function parseImportPayload(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let parsed;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }

  if (parsed && parsed.schema === 'quiz-progress-export' && parsed.schemaVersion === 1 && parsed.banks) {
    return parsed;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const banksMap = {};
    for (const [bankId, maybeState] of Object.entries(parsed)) {
      if (isValidState(maybeState)) banksMap[bankId] = { name: '', state: maybeState };
    }
    if (Object.keys(banksMap).length > 0) {
      return {
        schema: 'quiz-progress-export',
        schemaVersion: 1,
        exportedAt: 0,
        storagePrefix: STORAGE_PREFIX,
        banks: banksMap,
      };
    }
  }
  return null;
}

function importProgressFromPayload(payload) {
  const banksMap = payload?.banks && typeof payload.banks === 'object' ? payload.banks : null;
  if (!banksMap) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;
  for (const [bankId, entry] of Object.entries(banksMap)) {
    const st = entry && typeof entry === 'object' ? entry.state : null;
    if (!isValidState(st)) {
      skipped++;
      continue;
    }
    try {
      const existing = loadState(bankId);
      const merged = mergeStates(existing, st);
      saveState(bankId, merged);
      imported++;
    } catch (e) {
      console.warn('导入进度失败', bankId, e);
      skipped++;
    }
  }
  return { imported, skipped };
}

/* ---------- 二维码同步（紧凑编码，适合 URL/二维码） ---------- */

function toB64Url(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  str = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function encodeCompactProgress() {
  const statesByBankId = getAllSavedBankStates();
  const banks = {};
  for (const [bankId, st] of Object.entries(statesByBankId)) {
    if (!isValidState(st) || !Array.isArray(st.questionIds)) continue;
    let s = '';
    for (const qid of st.questionIds) {
      const rec = st.answers?.[qid];
      if (!rec) s += '.';
      else if (rec.correct) s += 'c';
      else s += 'w';
    }
    banks[bankId] = s;
  }
  return { v: 2, ts: Date.now(), b: banks };
}

const PENDING_PREFIX = 'quizPendingImport_v2:';

function mergeCompactIntoAnswers(answers, questionIds, str) {
  const out = { ...(answers || {}) };
  questionIds.forEach((qid, i) => {
    const ch = str[i];
    if (ch !== 'c' && ch !== 'w') return;
    const prev = out[qid];
    const prevWrong = prev && prev.correct === false;
    const incomingWrong = ch === 'w';
    if (prevWrong || incomingWrong) {
      out[qid] = { response: prev?.response || '', correct: false, ts: Date.now() };
    } else if (!prev) {
      out[qid] = { response: '', correct: true, ts: Date.now() };
    }
  });
  return out;
}

function applyCompactProgress(obj) {
  if (!obj || obj.v !== 2 || !obj.b || typeof obj.b !== 'object') return { imported: 0, skipped: 0 };
  let imported = 0;
  let skipped = 0;
  for (const [bankId, str] of Object.entries(obj.b)) {
    if (typeof str !== 'string') { skipped++; continue; }
    // 不管有没有 existing state，都存一份 pending import，等 enterBank 加载题目后按位置合并
    try { localStorage.setItem(PENDING_PREFIX + bankId, str); } catch {}
    const existing = loadState(bankId);
    if (isValidState(existing) && Array.isArray(existing.questionIds)) {
      const merged = mergeCompactIntoAnswers(existing.answers, existing.questionIds, str);
      saveState(bankId, { ...existing, answers: merged });
    }
    imported++;
  }
  return { imported, skipped };
}

function consumePendingImport(bankId, questionIds) {
  let str = null;
  try { str = localStorage.getItem(PENDING_PREFIX + bankId); } catch {}
  if (!str) return null;
  try { localStorage.removeItem(PENDING_PREFIX + bankId); } catch {}
  if (!Array.isArray(questionIds) || !questionIds.length) return null;
  return mergeCompactIntoAnswers({}, questionIds, str);
}

function buildSyncUrl() {
  const compact = encodeCompactProgress();
  const b64 = toB64Url(compact);
  const base = location.origin + location.pathname;
  return `${base}#sync=${b64}`;
}

/* ---------- 题目反馈 ---------- */

function formatOptionsForIssue(options) {
  if (!options || typeof options !== 'object') return '';
  const labels = Object.keys(options);
  labels.sort();
  return labels.map((k) => `${k}. ${String(options[k] ?? '')}`.trim()).join('\n');
}

function buildIssueUrl(bank, meta, qid, q, state) {
  const bankName = bank?.name || bank?.id || '';
  const title = `[题目反馈] ${bankName} - ${qid}`;
  const saved = state?.answers?.[qid] ?? null;
  const myResponse = saved
    ? (Array.isArray(saved.response) ? saved.response.join('') : String(saved.response ?? ''))
    : '';

  const bodyLines = [
    `题库：${bankName}`,
    meta?.source ? `题库来源：${meta.source}` : '',
    `题目ID：${qid}`,
    q?.type ? `题型：${typeLabel(q.type)}` : '',
    '',
    '【题干】',
    String(q?.stem ?? ''),
    '',
    '【选项】',
    formatOptionsForIssue(q?.options),
    '',
    '【正确答案】',
    String(q?.answer ?? ''),
    '',
    '【我的作答】',
    myResponse || '（未作答）',
    '',
    '【问题描述】',
    '请描述题干/选项/答案哪里有误，或哪里不清楚。',
  ].filter((x) => x !== '');

  const params = new URLSearchParams();
  params.set('title', title);
  params.set('body', bodyLines.join('\n'));
  return `${GITHUB_ISSUES_NEW_URL}?${params.toString()}`;
}

/* ---------- 主流程 ---------- */

async function main() {
  const homeView = $('homeView');
  const quizView = $('quizView');
  const banksList = $('banksList');
  const homeEmpty = $('homeEmpty');

  const backHomeBtn = $('backHomeBtn');
  const toggleModeBtn = $('toggleModeBtn');
  const resetBtn = $('resetBtn');

  function showHome() {
    homeView.hidden = false;
    quizView.hidden = true;
    backHomeBtn.hidden = true;
    toggleModeBtn.hidden = true;
    resetBtn.hidden = true;
    $('meta').textContent = '';
  }

  function showQuiz() {
    homeView.hidden = true;
    quizView.hidden = false;
    backHomeBtn.hidden = false;
    toggleModeBtn.hidden = false;
    resetBtn.hidden = false;
  }

  function parseHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    const params = new URLSearchParams(raw);
    return { bankId: params.get('bank') };
  }

  async function fetchBanksIndex() {
    const res = await fetch(BANKS_INDEX_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load banks index');
    return await res.json();
  }

  function ensureStateFor(bankId, questionIds) {
    let state = loadState(bankId);
    if (!state || state.version !== 1 || !Array.isArray(state.questionIds)) {
      state = makeInitialState(questionIds);
      saveState(bankId, state);
    }
    // 合并扫码导入的 pending 进度（新设备首次进入某题库时生效）
    const pendingAnswers = consumePendingImport(bankId, questionIds);
    if (pendingAnswers) {
      const mergedAnswers = { ...(state.answers || {}) };
      for (const [qid, rec] of Object.entries(pendingAnswers)) {
        const prev = mergedAnswers[qid];
        const prevWrong = prev && prev.correct === false;
        const inWrong = rec.correct === false;
        if (prevWrong || inWrong) mergedAnswers[qid] = { response: prev?.response || '', correct: false, ts: Date.now() };
        else if (!prev) mergedAnswers[qid] = rec;
      }
      state = { ...state, answers: mergedAnswers };
      saveState(bankId, state);
    }

    const prev = new Set(state.questionIds);
    const next = new Set(questionIds);
    const changed = prev.size !== next.size || [...prev].some((x) => !next.has(x));
    if (changed) {
      const nextAnswers = {};
      for (const qid of questionIds) {
        if (state.answers?.[qid]) nextAnswers[qid] = state.answers[qid];
      }
      state.questionIds = questionIds;
      state.answers = nextAnswers;
      state.currentIndexAll = 0;
      state.currentIndexWrong = 0;
      state.mode = 'all';
      saveState(bankId, state);
    }
    return state;
  }

  function renderHomeList(banks) {
    banksList.innerHTML = '';
    if (!banks || banks.length === 0) {
      homeEmpty.hidden = false;
      homeEmpty.textContent = '没有找到题库文件。请把题库放进 banks/ 目录并更新 banks/index.json。';
      return;
    }
    homeEmpty.hidden = true;

    for (const b of banks) {
      const state = loadState(b.id) || makeInitialState([]);
      const total = Number(b.count || state.questionIds?.length || 0);
      const stats = computeStats(state);
      const pct = total ? Math.round((stats.answered / total) * 100) : 0;

      const row = document.createElement('div');
      row.className = 'bank';

      const left = document.createElement('div');
      left.className = 'bank-left';

      const name = document.createElement('div');
      name.className = 'bank-name';
      name.textContent = b.name;

      const meta = document.createElement('div');
      meta.className = 'bank-meta';
      meta.textContent = `已答 ${stats.answered}/${total} · 正确 ${stats.correct} · 错误 ${stats.wrong}`;

      const prog = document.createElement('div');
      prog.className = 'bank-progress';
      const bar = document.createElement('div');
      bar.className = 'bank-bar';
      const fill = document.createElement('div');
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      const pctEl = document.createElement('div');
      pctEl.className = 'bank-pct';
      pctEl.textContent = `${pct}%`;
      prog.appendChild(bar);
      prog.appendChild(pctEl);

      left.appendChild(name);
      left.appendChild(meta);
      left.appendChild(prog);

      const right = document.createElement('div');
      right.className = 'bank-actions';

      const safeName = String(b.name || b.id || 'questions')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .slice(0, 80);

      const dl = document.createElement('a');
      dl.className = 'btn btn-secondary btn-icon';
      if (b.sourcePdfPath) {
        dl.href = `./${b.sourcePdfPath}`;
        dl.download = `${safeName}.pdf`;
        dl.title = '下载原题库（PDF）';
        dl.setAttribute('aria-label', '下载原题库（PDF）');
      } else {
        dl.href = `./${b.questionsPath}`;
        dl.download = `${safeName}.questions.json`;
        dl.title = '下载题库（JSON）';
        dl.setAttribute('aria-label', '下载题库（JSON）');
      }
      dl.innerHTML =
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1z"/>'
        + '<path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/>'
        + '</svg>';

      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.type = 'button';
      btn.textContent = stats.answered > 0 ? '继续' : '开始';
      btn.addEventListener('click', () => {
        location.hash = `bank=${encodeURIComponent(b.id)}`;
      });

      right.appendChild(dl);
      right.appendChild(btn);

      row.appendChild(left);
      row.appendChild(right);
      banksList.appendChild(row);
    }
  }

  let banksIndex = null;
  try {
    banksIndex = await fetchBanksIndex();
  } catch (e) {
    console.error(e);
    showHome();
    homeEmpty.hidden = false;
    homeEmpty.textContent = '无法加载题库索引（banks/index.json）。请确认文件已部署。';
    return;
  }

  const banks = banksIndex.banks || [];

  function setTransferMsg(msg, isError) {
    if (!transferMsg) return;
    transferMsg.textContent = msg || '';
    transferMsg.classList.toggle('err', !!isError);
  }

  const exportProgressBtn = $('exportProgressBtn');
  const importProgressBtn = $('importProgressBtn');
  const exportText = $('exportText');
  const importText = $('importText');
  const transferMsg = $('transferMsg');

  if (exportProgressBtn && exportText) {
    exportProgressBtn.addEventListener('click', async () => {
      setTransferMsg('');
      const payload = buildExportPayload(banks);
      const text = JSON.stringify(payload);
      exportText.value = text;
      const ok = await copyText(text);
      setTransferMsg(ok ? '已复制到剪贴板。' : '已生成文本，请手动复制。');
    });
  }

  if (importProgressBtn && importText) {
    importProgressBtn.addEventListener('click', () => {
      setTransferMsg('');
      const payload = parseImportPayload(importText.value);
      if (!payload) {
        setTransferMsg('导入失败：文本格式不正确。', true);
        return;
      }
      const { imported, skipped } = importProgressFromPayload(payload);
      renderHomeList(banks);
      setTransferMsg(`已导入 ${imported} 个题库进度（跳过 ${skipped} 个）。`);
    });
  }

  /* ----- 二维码同步 ----- */
  const qrModal = $('qrModal');
  const qrModalTitle = $('qrModalTitle');
  const qrModalBody = $('qrModalBody');
  let html5QrScanner = null;

  function openQrModal(title) {
    qrModalTitle.textContent = title || '';
    qrModalBody.innerHTML = '';
    qrModal.hidden = false;
  }
  function closeQrModal() {
    qrModal.hidden = true;
    qrModalBody.innerHTML = '';
    if (html5QrScanner) { try { html5QrScanner.stop().catch(()=>{}); } catch {} html5QrScanner = null; }
  }
  qrModal.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closeQrModal);
  });

  const exportQrBtn = $('exportQrBtn');
  if (exportQrBtn) {
    exportQrBtn.addEventListener('click', async () => {
      const url = buildSyncUrl();
      openQrModal('扫码同步进度');
      qrModalBody.innerHTML =
        '<div class="qr-hint">用另一台设备的相机扫这个码，会自动打开本网页并同步进度。</div>' +
        '<div id="qrCanvas" class="qr-canvas"></div>' +
        '<div class="qr-url">' + url.replace(/&/g,'&amp;') + '</div>';
      try {
        new QRCode(document.getElementById('qrCanvas'), {
          text: url,
          width: 260,
          height: 260,
          colorDark: '#e8e6e3',
          colorLight: '#1c1c1e',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        qrModalBody.insertAdjacentHTML('afterbegin', '<div class="qr-hint" style="color:#ff6b6b">二维码生成失败：' + e.message + '</div>');
      }
    });
  }

  const scanQrBtn = $('scanQrBtn');
  if (scanQrBtn) {
    scanQrBtn.addEventListener('click', () => {
      openQrModal('扫描设备上的二维码');
      qrModalBody.innerHTML =
        '<div class="qr-hint">请将另一台设备屏幕上的二维码对准摄像头。</div>' +
        '<div id="qrReader" class="qr-reader"></div>';
      try {
        html5QrScanner = new Html5Qrcode('qrReader');
        html5QrScanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            // 成功识别
            try {
              const u = new URL(decodedText);
              const sync = u.hash.match(/sync=([^&]+)/);
              if (sync) {
                const obj = fromB64Url(sync[1]);
                const r = applyCompactProgress(obj);
                renderHomeList(banks);
                closeQrModal();
                setTransferMsg(`已从二维码导入 ${r.imported} 个题库进度。`);
                return;
              }
            } catch {}
            // 不是 sync URL，尝试当紧凑 base64
            try {
              const obj = fromB64Url(decodedText);
              const r = applyCompactProgress(obj);
              if (r.imported > 0) {
                renderHomeList(banks);
                closeQrModal();
                setTransferMsg(`已从二维码导入 ${r.imported} 个题库进度。`);
              }
            } catch {}
          },
          () => { /* 每帧失败忽略 */ }
        ).catch((e) => {
          qrModalBody.insertAdjacentHTML('afterbegin', '<div class="qr-hint" style="color:#ff6b6b">摄像头启动失败：' + e.message + '<br>请确认已授权摄像头权限。</div>');
        });
      } catch (e) {
        qrModalBody.insertAdjacentHTML('afterbegin', '<div class="qr-hint" style="color:#ff6b6b">扫码库初始化失败：' + e.message + '</div>');
      }
    });
  }

  /* 启动时检测 URL hash 里的 sync 参数（扫码后自动导入） */
  (function applySyncFromHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    const params = new URLSearchParams(raw);
    const sync = params.get('sync');
    if (!sync) return;
    try {
      const obj = fromB64Url(sync);
      const r = applyCompactProgress(obj);
      // 清掉 sync 参数，保留其他参数（如 bank）
      params.delete('sync');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? '#' + rest : ''));
      if (r.imported > 0) {
        setTransferMsg(`已从扫码链接导入 ${r.imported} 个题库进度。`);
      }
    } catch (e) {
      console.warn('sync hash 解析失败', e);
    }
  })();

  /* 刷题运行时状态 */
  let currentBank = null;
  let meta = {};
  let questionsById = {};
  let questionIds = [];
  let state = null;

  function rerenderQuiz() {
    renderProgress(meta, state);
    renderQuestion(questionsById, state, currentBank);
  }

  function getCurrentQA() {
    const activeIds = getActiveIds(state);
    if (activeIds.length === 0) return null;
    const qid = activeIds[getActiveIndex(state)];
    const q = questionsById[qid];
    if (!q) return null;
    return { qid, q };
  }

  function submitCurrentAnswer() {
    const qa = getCurrentQA();
    if (!qa) return;
    const { qid, q } = qa;
    if (state.answers?.[qid]) return;

    const response = collectResponse(q);
    if (q.type === 'blank') {
      if (!String(response ?? '').trim()) return;
    } else if (q.type === 'multiple') {
      if (!Array.isArray(response) || response.length === 0) return;
    } else {
      if (!String(response ?? '').trim()) return;
    }

    const correct = grade(q, response);
    state.answers[qid] = { response, correct, ts: Date.now() };
    saveState(currentBank.id, state);
    rerenderQuiz();
    scrollResultIntoView();
  }

  $('answerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitCurrentAnswer();
  });

  /* 单选/判断题：点击选项即提交；多选题需点“确认答案” */
  document.addEventListener('change', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.closest('#options') == null) return;

    const qa = getCurrentQA();
    if (!qa) return;
    const { qid, q } = qa;
    if (state.answers?.[qid]) return;

    /* 视觉选中态 */
    for (const opt of document.querySelectorAll('#options .option')) {
      const input = opt.querySelector('input');
      opt.classList.toggle('selected', input.checked);
    }

    if (q.type === 'multiple') {
      const submitBtn = $('submitBtn');
      if (submitBtn) {
        const selectedCount = document.querySelectorAll('#options input:checked').length;
        submitBtn.disabled = selectedCount === 0;
      }
    } else {
      submitCurrentAnswer();
    }
  });

  $('blankText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCurrentAnswer();
    }
  });

  $('nextBtn').addEventListener('click', () => {
    const activeIds = getActiveIds(state);
    if (activeIds.length === 0) return;

    const idx = getActiveIndex(state);
    if (idx + 1 < activeIds.length) {
      setActiveIndex(state, idx + 1);
      saveState(currentBank.id, state);
      rerenderQuiz();
      scrollToTop();
      return;
    }

    if (state.mode === 'wrong') {
      renderEmpty('错题已回顾完成。点击“返回练习”继续。');
      return;
    }

    const wrongCount = buildWrongIds(state).length;
    if (wrongCount > 0) {
      renderEmpty(`本轮练习已完成（共 ${state.questionIds.length} 题）。你有 ${wrongCount} 道错题，可点击“错题回顾”复盘。`);
    } else {
      renderEmpty(`本轮练习已完成（共 ${state.questionIds.length} 题）。全部正确，做得不错。`);
    }
  });

  /* 上一题：可一直返回到第一题 */
  $('prevBtn').addEventListener('click', () => {
    const idx = getActiveIndex(state);
    if (idx <= 0) return;
    setActiveIndex(state, idx - 1);
    saveState(currentBank.id, state);
    rerenderQuiz();
    scrollToTop();
  });

  /* 标为已会：从错题集移除当前题（仅错题回顾模式显示） */
  $('forgiveBtn').addEventListener('click', () => {
    if (state.mode !== 'wrong') return;
    const qa = getCurrentQA();
    if (!qa) return;
    const { qid } = qa;

    delete state.answers[qid];
    saveState(currentBank.id, state);

    /* 修正游标：删除后错题列表变短，若越界则回退到末位 */
    const wrongIds = buildWrongIds(state);
    let idx = getActiveIndex(state);
    if (idx >= wrongIds.length) idx = Math.max(0, wrongIds.length - 1);
    setActiveIndex(state, idx);
    rerenderQuiz();
    scrollToTop();
  });

  toggleModeBtn.addEventListener('click', () => {
    if (state.mode === 'wrong') {
      setMode(state, 'all');
    } else {
      setMode(state, 'wrong');
      state.currentIndexWrong = 0;
    }
    saveState(currentBank.id, state);
    rerenderQuiz();
  });

  resetBtn.addEventListener('click', () => {
    const ok = confirm('确定要清空全部答题记录吗？');
    if (!ok) return;
    state = makeInitialState(questionIds);
    saveState(currentBank.id, state);
    rerenderQuiz();
  });

  backHomeBtn.addEventListener('click', () => {
    location.hash = '';
  });

  $('feedbackBtn').addEventListener('click', () => {
    const qa = getCurrentQA();
    if (!qa) return;
    try {
      window.location.assign(buildIssueUrl(currentBank, meta, qa.qid, qa.q, state));
    } catch (e) {
      console.error(e);
      alert('无法打开反馈链接，请稍后再试。');
    }
  });

  async function enterBank(bankId) {
    const bank = banks.find((b) => b.id === bankId);
    if (!bank) {
      showHome();
      renderHomeList(banks);
      return;
    }

    showQuiz();
    currentBank = bank;
    $('meta').textContent = `题库：${bank.name}`;

    const res = await fetch(`./${bank.questionsPath}`, { cache: 'no-store' });
    if (!res.ok) {
      renderEmpty('无法加载该题库的 questions.json。');
      return;
    }

    const data = await res.json();
    meta = data.meta || {};
    const questions = data.questions || [];

    questionsById = {};
    questionIds = [];
    for (const q of questions) {
      const id = String(q.id);
      questionsById[id] = q;
      questionIds.push(id);
    }

    state = ensureStateFor(bank.id, questionIds);
    rerenderQuiz();
  }

  function handleRoute() {
    const { bankId } = parseHash();
    if (!bankId) {
      showHome();
      renderHomeList(banks);
      return;
    }
    enterBank(bankId).catch((e) => {
      console.error(e);
      showHome();
      renderHomeList(banks);
    });
  }

  window.addEventListener('hashchange', () => {
    handleRoute();
  });

  handleRoute();
}

main().catch((err) => {
  console.error(err);
  renderEmpty('加载失败：请查看控制台错误。');
});
