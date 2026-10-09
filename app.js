'use strict';

// ---------- Настройки ----------
// Заполните после регистрации Mini App у @BotFather (/newapp).
// Ссылка вида https://t.me/<BOT_USERNAME>/<APP_SHORT_NAME>?startapp=<код слова>
const BOT_USERNAME = 'nbukv_bot';    // например 'nbukv_bot'
const APP_SHORT_NAME = 'nbukv_puzzle';  // например 'play'

const MIN_LEN = 3;
const MAX_LEN = 10;
// Ё приравнивается к Е, поэтому её нет в алфавите
const ALPHABET = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
const MIN_ROWS = 6; // сколько строк поля показывать заранее
const KEYBOARD = ['йцукенгшщзхъ', 'фывапролджэ', '⏎ячсмитьбю⌫'];

const tg = window.Telegram && window.Telegram.WebApp;
const $ = (id) => document.getElementById(id);

// ---------- Кодирование слова в ссылке ----------
// Слово не передаётся открытым текстом, чтобы его нельзя было подсмотреть в ссылке.
// Формат: [соль, ...индексы букв со сдвигом] -> base64url.

function normalize(s) {
  return s.trim().toLowerCase().replace(/ё/g, 'е');
}

function encodeWord(word) {
  const salt = Math.floor(Math.random() * 256);
  const bytes = [salt, ...[...word].map((ch, i) => (ALPHABET.indexOf(ch) + salt + i * 37) % 256)];
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeWord(code) {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = [...atob(b64)].map((c) => c.charCodeAt(0));
    const [salt, ...rest] = bytes;
    if (rest.length < MIN_LEN || rest.length > MAX_LEN) return null;
    const idx = rest.map((b, i) => (((b - salt - i * 37) % 256) + 256) % 256);
    if (idx.some((x) => x >= ALPHABET.length)) return null;
    return idx.map((x) => ALPHABET[x]).join('');
  } catch (e) {
    return null;
  }
}

function buildLink(code) {
  if (BOT_USERNAME && APP_SHORT_NAME) {
    return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=${code}`;
  }
  // Запасной вариант для проверки в обычном браузере
  return `${location.origin}${location.pathname}?w=${code}`;
}

function getStartParam() {
  const q = new URLSearchParams(location.search);
  return (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param)
    || q.get('tgWebAppStartParam')
    || q.get('w');
}

// ---------- Подсчёт подсказок ----------
// correct — на своём месте, present — есть в слове на другом месте, absent — нет.
// Повторы учитываются: буква подсвечивается не чаще, чем встречается в ответе.
function score(guess, answer) {
  const n = answer.length;
  const res = Array(n).fill('absent');
  const left = {};
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) res[i] = 'correct';
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < n; i++) {
    if (res[i] !== 'correct' && left[guess[i]] > 0) {
      res[i] = 'present';
      left[guess[i]]--;
    }
  }
  return res;
}

// ---------- Общие утилиты ----------
function haptic(type) {
  try { tg && tg.HapticFeedback.notificationOccurred(type); } catch (e) {}
}

function share(url, text) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg && tg.openTelegramLink) tg.openTelegramLink(shareUrl);
  else window.open(shareUrl, '_blank');
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

// ---------- Оформление ----------
function setLogo(first) {
  $('logo').innerHTML = [...`${first}БУКВ`].map((ch) => `<span>${ch}</span>`).join('');
}

function initRules() {
  const modal = $('rules');
  const open = () => modal.classList.remove('hidden');
  const close = () => {
    modal.classList.add('hidden');
    storageSet('nbukv:rules-seen', true);
  };
  $('btn-rules').onclick = open;
  $('rules-close').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  return { open, seen: () => !!storageGet('nbukv:rules-seen') };
}

// ---------- Экран загадывающего ----------
function showCreate() {
  $('play').classList.add('hidden');
  $('create').classList.remove('hidden');
  $('attempts').classList.add('hidden');
  $('btn-new').classList.add('hidden');
  setLogo('N');
  if (tg) tg.BackButton.hide();

  const input = $('secret');
  const err = $('create-error');
  const preview = $('preview');

  // Загаданное слово сразу показывается плитками
  function renderPreview() {
    const word = normalize(input.value).replace(/[^а-я]/g, '').slice(0, MAX_LEN);
    const n = Math.max(word.length, 5);
    preview.style.setProperty('--n', n);
    preview.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const t = document.createElement('div');
      t.className = word[i] ? 'tile correct' : 'tile';
      t.textContent = word[i] || '';
      preview.appendChild(t);
    }
  }

  function resetLink() {
    $('link-box').classList.add('hidden');
    $('create-actions').classList.remove('hidden');
  }

  renderPreview();
  resetLink();
  input.oninput = () => {
    err.textContent = '';
    resetLink();
    renderPreview();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') $('make-link').click(); };

  $('make-link').onclick = () => {
    const word = normalize(input.value);
    if (!/^[а-я]+$/.test(word)) {
      err.textContent = 'Только русские буквы, без пробелов и дефисов.';
      haptic('error');
      return;
    }
    if (word.length < MIN_LEN || word.length > MAX_LEN) {
      err.textContent = `Длина слова — от ${MIN_LEN} до ${MAX_LEN} букв.`;
      haptic('error');
      return;
    }
    const link = buildLink(encodeWord(word));
    $('link').value = link;
    $('link-len').textContent = `${word.length} ${plural(word.length, 'буквы', 'букв', 'букв')}`;
    $('link-box').classList.remove('hidden');
    $('create-actions').classList.add('hidden');
    input.blur();
    haptic('success');

    $('share-link').onclick = () =>
      share(link, `Отгадай слово из ${word.length} ${plural(word.length, 'буквы', 'букв', 'букв')}!`);
    $('copy-link').onclick = async () => {
      const ok = await copy(link);
      $('copy-link').textContent = ok ? 'Скопировано' : 'Не удалось';
      setTimeout(() => { $('copy-link').textContent = 'Копировать'; }, 1500);
    };
  };
}

// ---------- Экран отгадывающего ----------
function showPlay(code, answer) {
  $('create').classList.add('hidden');
  $('play').classList.remove('hidden');

  const n = answer.length;
  const saveKey = `nbukv:${code}`;
  const saved = storageGet(saveKey) || { guesses: [], finished: false, gaveUp: false };
  const state = { guesses: saved.guesses, current: '', finished: saved.finished, gaveUp: saved.gaveUp };

  const board = $('board');
  board.style.setProperty('--n', n);
  setLogo(n);
  $('attempts').classList.remove('hidden');
  $('btn-new').classList.remove('hidden');
  $('btn-new').onclick = () => showCreate();

  if (tg) {
    tg.BackButton.show();
    tg.BackButton.onClick(() => showCreate());
  }

  const hintText = `Составьте слово из ${n} ${plural(n, 'буквы', 'букв', 'букв')}`;
  let inputRow = null;

  const keyEls = {};
  const keyState = {}; // буква -> лучший известный статус
  const rank = { absent: 1, present: 2, correct: 3 };

  function buildKeyboard() {
    const kb = $('keyboard');
    kb.innerHTML = '';
    for (const row of KEYBOARD) {
      const r = document.createElement('div');
      r.className = 'kb-row';
      for (const ch of row) {
        const b = document.createElement('button');
        b.className = 'key';
        if (ch === '⏎') { b.textContent = 'Ввод'; b.classList.add('wide', 'enter'); b.onclick = submit; }
        else if (ch === '⌫') { b.textContent = '⌫'; b.classList.add('wide'); b.onclick = backspace; }
        else { b.textContent = ch; b.onclick = () => type(ch); keyEls[ch] = b; }
        r.appendChild(b);
      }
      kb.appendChild(r);
    }
  }

  function updateKey(ch, status) {
    if ((rank[status] || 0) <= (rank[keyState[ch]] || 0)) return;
    keyState[ch] = status;
    const el = keyEls[ch];
    if (el) {
      el.classList.remove('absent', 'present', 'correct');
      el.classList.add(status);
    }
  }

  function makeRow(word, statuses, animate) {
    const row = document.createElement('div');
    row.className = 'board-row';
    for (let i = 0; i < n; i++) {
      const t = document.createElement('div');
      t.className = 'tile';
      t.textContent = word[i] || '';
      if (statuses) {
        t.classList.add(statuses[i]);
        if (animate) {
          t.classList.add('reveal');
          t.style.animationDelay = `${i * 80}ms`;
        }
      } else if (word[i]) {
        t.classList.add('filled');
      }
      row.appendChild(t);
    }
    return row;
  }

  function render(animateLast) {
    board.innerHTML = '';
    state.guesses.forEach((g, i) => {
      const st = score(g, answer);
      board.appendChild(makeRow(g, st, animateLast && i === state.guesses.length - 1));
      [...g].forEach((ch, j) => updateKey(ch, st[j]));
    });
    inputRow = null;
    if (!state.finished) {
      inputRow = makeRow(state.current, null);
      board.appendChild(inputRow);
    }
    // Пустые строки «на будущее», как в сетке кроссворда
    while (board.children.length < MIN_ROWS) board.appendChild(makeRow('', null));
    $('attempts').textContent = state.guesses.length;
    $('attempts').title = `Попыток: ${state.guesses.length}`;
    const target = inputRow || board.children[state.guesses.length - 1];
    if (target) target.scrollIntoView({ block: 'nearest' });
  }

  function currentRow() {
    return inputRow;
  }

  function toast(msg) {
    $('toast').textContent = msg;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { if (!state.finished) $('toast').textContent = hintText; }, 2000);
  }

  function type(ch) {
    if (state.finished || state.current.length >= n) return;
    state.current += ch;
    const tile = currentRow().children[state.current.length - 1];
    tile.textContent = ch;
    tile.classList.add('filled');
  }

  function backspace() {
    if (state.finished || !state.current) return;
    const tile = currentRow().children[state.current.length - 1];
    tile.textContent = '';
    tile.classList.remove('filled');
    state.current = state.current.slice(0, -1);
  }

  function submit() {
    if (state.finished) return;
    if (state.current.length < n) {
      const row = currentRow();
      row.classList.remove('shake');
      void row.offsetWidth;
      row.classList.add('shake');
      toast(`Нужно ${n} ${plural(n, 'буква', 'буквы', 'букв')}`);
      haptic('error');
      return;
    }
    state.guesses.push(state.current);
    state.current = '';
    if (state.guesses[state.guesses.length - 1] === answer) {
      state.finished = true;
      haptic('success');
    } else {
      haptic('warning');
    }
    persist();
    render(true);
    if (state.finished) showResult();
  }

  function giveUp() {
    if (state.finished) return;
    const doIt = () => {
      state.finished = true;
      state.gaveUp = true;
      persist();
      render(false);
      showResult();
    };
    if (tg && tg.showConfirm) tg.showConfirm('Сдаться и узнать слово?', (ok) => ok && doIt());
    else if (confirm('Сдаться и узнать слово?')) doIt();
  }

  function persist() {
    storageSet(saveKey, { guesses: state.guesses, finished: state.finished, gaveUp: state.gaveUp });
  }

  function showResult() {
    const k = state.guesses.length;
    $('result').classList.remove('hidden');
    $('keyboard').classList.add('hidden');
    $('give-up').classList.add('hidden');
    clearTimeout(toast.t);
    $('toast').textContent = state.gaveUp
      ? `Загаданное слово: ${answer.toUpperCase()}`
      : `Угадано за ${k} ${plural(k, 'попытку', 'попытки', 'попыток')}!`;

    const emoji = { absent: '⬛', present: '⬜', correct: '🟨' };
    const grid = state.guesses.map((g) => score(g, answer).map((s) => emoji[s]).join('')).join('\n');
    const summary = state.gaveUp
      ? `N букв: сдался после ${k} ${plural(k, 'попытки', 'попыток', 'попыток')}`
      : `N букв: отгадал за ${k} ${plural(k, 'попытку', 'попытки', 'попыток')}`;

    $('share-result').onclick = () => share(buildLink(code), `${summary}\n${grid}`);
    $('new-game').onclick = () => showCreate();
  }

  document.onkeydown = (e) => {
    if ($('play').classList.contains('hidden') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); backspace(); return; }
    const ch = normalize(e.key);
    if (ch.length === 1 && ALPHABET.includes(ch)) type(ch);
  };

  $('give-up').onclick = giveUp;
  $('toast').textContent = hintText;
  $('result').classList.add('hidden');
  $('keyboard').classList.remove('hidden');
  $('give-up').classList.remove('hidden');
  buildKeyboard();
  render(false);
  if (state.finished) showResult();
}

// ---------- Запуск ----------
function init() {
  window.__nbukvStarted = true;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor('#1f1f21');
      tg.setBackgroundColor('#1f1f21');
      if (tg.setBottomBarColor) tg.setBottomBarColor('#2c2c2f');
    } catch (e) {}
  }
  const code = getStartParam();
  const answer = code && decodeWord(code);

  // Ссылка на слово открыта в обычном браузере — отправляем в Telegram
  const inTelegram = !!(tg && tg.initData);
  if (answer && !inTelegram && BOT_USERNAME && APP_SHORT_NAME) {
    location.replace(buildLink(code));
    return;
  }

  const rules = initRules();
  if (answer) {
    showPlay(code, answer);
    if (!rules.seen()) rules.open();
  } else {
    showCreate();
    if (code) $('create-error').textContent = 'Ссылка повреждена — не удалось прочитать слово.';
  }
}

init();
