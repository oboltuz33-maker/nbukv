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
// Формат: [соль, ...данные со сдвигом] -> base64url, где данные —
// [длина слова, ...индексы букв, ...имя автора в UTF-8, контрольная сумма].
// Старые ссылки (только [соль, ...буквы]) тоже читаются.

const AUTHOR_MAX = 24;

function normalize(s) {
  return s.trim().toLowerCase().replace(/ё/g, 'е');
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  return [...atob(code.replace(/-/g, '+').replace(/_/g, '/'))].map((c) => c.charCodeAt(0));
}

const shift = (b, salt, i) => (b + salt + i * 37) % 256;
const unshift = (b, salt, i) => (((b - salt - i * 37) % 256) + 256) % 256;
const checksum = (arr) => arr.reduce((s, b) => (s + b) % 256, 0);

function encodePuzzle(word, author) {
  const salt = Math.floor(Math.random() * 256);
  const name = new TextEncoder().encode([...(author || '')].slice(0, AUTHOR_MAX).join(''));
  const data = [word.length, ...[...word].map((ch) => ALPHABET.indexOf(ch)), ...name];
  data.push(checksum(data));
  return toBase64Url([salt, ...data.map((b, i) => shift(b, salt, i))]);
}

function decodePuzzle(code) {
  let bytes;
  try { bytes = fromBase64Url(code); } catch (e) { return null; }
  const [salt, ...rest] = bytes;
  const toWord = (idx) => (idx.every((x) => x < ALPHABET.length) ? idx.map((x) => ALPHABET[x]).join('') : null);

  const data = rest.map((b, i) => unshift(b, salt, i));
  const n = data[0];
  if (data.length >= n + 2 && n >= MIN_LEN && n <= MAX_LEN
      && checksum(data.slice(0, -1)) === data[data.length - 1]) {
    const word = toWord(data.slice(1, n + 1));
    if (word) {
      let author = '';
      try {
        author = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(data.slice(n + 1, -1)));
      } catch (e) {}
      return { word, author };
    }
  }

  // Старый формат без длины и автора
  if (rest.length >= MIN_LEN && rest.length <= MAX_LEN) {
    const word = toWord(rest.map((b, i) => unshift(b, salt, i)));
    if (word) return { word, author: '' };
  }
  return null;
}

function currentUserName() {
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  return (user && (user.first_name || user.username)) || '';
}

// ---------- Словарь ----------
// words.txt и random.txt собираются скриптом scripts/build-dict.js
const DICT_URL = 'words.txt?v=1';     // все допустимые слова — для проверки попыток
const RANDOM_URL = 'random.txt?v=1';  // узнаваемые слова 4–8 букв — для случайной игры
const RANDOM_LENGTHS = [4, 5, 6, 7, 8];
const RECENT_MAX = 100;               // столько последних случайных слов не повторяем

// Загружает список слов один раз; при ошибке следующий вызов попробует снова
function wordListLoader(url) {
  const list = { words: null, promise: null };
  list.load = () => {
    if (list.words) return Promise.resolve(list.words);
    if (!list.promise) {
      list.promise = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then((text) => {
          list.words = text.split('\n').map((w) => w.trim()).filter(Boolean);
          return list.words;
        })
        .catch((e) => {
          list.promise = null;
          throw e;
        });
    }
    return list.promise;
  };
  return list;
}

const dict = wordListLoader(DICT_URL);
const randomWords = wordListLoader(RANDOM_URL);
let dictSet = null;

function loadDictionary() {
  return dict.load().then((words) => (dictSet = dictSet || new Set(words)));
}

async function isKnownNoun(word) {
  const words = await loadDictionary();
  return words.has(word);
}

async function pickRandomWord(len) {
  const pool = (await randomWords.load()).filter((w) => w.length === len);
  const recent = storageGet('nbukv:recent') || [];
  const fresh = pool.filter((w) => !recent.includes(w));
  const from = fresh.length ? fresh : pool;
  const word = from[Math.floor(Math.random() * from.length)];
  storageSet('nbukv:recent', [word, ...recent].slice(0, RECENT_MAX));
  return word;
}

// Случайная игра с собой: запоминаем код, чтобы продолжить её после перезапуска
async function startSolo(len) {
  const word = await pickRandomWord(len);
  const code = encodePuzzle(word, '');
  storageSet('nbukv:solo', code);
  showPlay(code, word, '', { solo: true });
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

// true, если слово пришло только из ?w= и нет никаких признаков запуска внутри Telegram
function isBrowserLink(code) {
  const q = new URLSearchParams(location.search);
  const fromTelegram = (tg && (tg.initData || (tg.initDataUnsafe && tg.initDataUnsafe.start_param)))
    || q.get('tgWebAppStartParam')
    || /tgWebApp/.test(location.hash);
  return !fromTelegram && q.get('w') === code;
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
  currentGame++; // таймеры прошлой игры больше не трогают экран

  // Игра с собой: выбор длины и случайное слово
  let soloLen = storageGet('nbukv:solo-len');
  if (!RANDOM_LENGTHS.includes(soloLen)) soloLen = 5;
  const picker = $('len-picker');
  picker.innerHTML = '';
  for (const len of RANDOM_LENGTHS) {
    const chip = document.createElement('button');
    chip.className = 'len-chip' + (len === soloLen ? ' active' : '');
    chip.textContent = len;
    chip.onclick = () => {
      soloLen = len;
      storageSet('nbukv:solo-len', len);
      [...picker.children].forEach((c) => c.classList.toggle('active', c === chip));
    };
    picker.appendChild(chip);
  }
  $('random-word').onclick = async () => {
    const btn = $('random-word');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Загадываем…';
    try {
      await startSolo(soloLen);
    } catch (e) {
      $('create-error').textContent = 'Не удалось загрузить словарь. Проверьте интернет и попробуйте ещё раз.';
      haptic('error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Случайное слово';
    }
  };

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

  $('make-link').onclick = async () => {
    const btn = $('make-link');
    if (btn.disabled) return;
    const word = normalize(input.value);
    const fail = (msg) => {
      err.textContent = msg;
      haptic('error');
    };
    if (!/^[а-я]+$/.test(word)) return fail('Только русские буквы, без пробелов и дефисов.');
    if (word.length < MIN_LEN || word.length > MAX_LEN) return fail(`Длина слова — от ${MIN_LEN} до ${MAX_LEN} букв.`);

    btn.disabled = true;
    btn.textContent = 'Проверяем слово…';
    let known;
    try {
      known = await isKnownNoun(word);
    } catch (e) {
      return fail('Не удалось загрузить словарь. Проверьте интернет и попробуйте ещё раз.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Загадать';
    }
    if (!known) return fail(`Слова «${word}» нет в словаре существительных в единственном числе.`);

    const link = buildLink(encodePuzzle(word, currentUserName()));
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
let currentGame = 0;

function showPlay(code, answer, author, opts = {}) {
  const gameId = ++currentGame;
  $('create').classList.add('hidden');
  $('play').classList.remove('hidden');
  $('author').textContent = author ? `Автор слова: ${author}` : '';
  $('author').classList.toggle('hidden', !author);

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

  if (tg) tg.BackButton.show();

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
    toast.t = setTimeout(() => {
      if (!state.finished && gameId === currentGame) $('toast').textContent = hintText;
    }, 2000);
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

  function reject(msg) {
    const row = currentRow();
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
    toast(msg);
    haptic('error');
  }

  let checking = false;
  async function submit() {
    if (state.finished || checking) return;
    if (state.current.length < n) return reject(`Нужно ${n} ${plural(n, 'буква', 'буквы', 'букв')}`);

    // Загаданное слово всегда засчитывается, остальные — только из словаря
    if (state.current !== answer) {
      checking = true;
      let known;
      try {
        if (!dict.words) toast('Загружаем словарь…');
        known = await isKnownNoun(state.current);
      } catch (e) {
        return reject('Не удалось загрузить словарь, попробуйте ещё раз');
      } finally {
        checking = false;
      }
      if (!known) return reject('Такого слова нет в словаре');
    }

    clearTimeout(toast.t);
    $('toast').textContent = hintText;
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
    const tries = state.gaveUp
      ? `${k} ${plural(k, 'попытки', 'попыток', 'попыток')}`
      : `${k} ${plural(k, 'попытку', 'попытки', 'попыток')}`;
    let summary;
    if (author) {
      summary = state.gaveUp
        ? `${author}, сдаюсь после ${tries}. Слово было ${answer.toUpperCase()}`
        : `${author}, твоё слово отгадано за ${tries}!`;
    } else {
      summary = state.gaveUp ? `N букв: сдаюсь после ${tries}` : `N букв: слово отгадано за ${tries}!`;
    }

    // Результат удобнее всего отправить в чат с автором слова
    $('share-result').textContent = author ? 'Отправить автору' : 'Поделиться';
    $('share-result').onclick = () => share(buildLink(code), `${summary}\n${grid}`);
    if (opts.solo) {
      $('new-game').textContent = 'Ещё слово';
      $('new-game').onclick = () => startSolo(n).catch(() => toast('Не удалось загрузить словарь'));
    } else {
      $('new-game').textContent = 'Загадать своё';
      $('new-game').onclick = () => showCreate();
    }
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
  const puzzle = code && decodePuzzle(code);

  // Старая ссылка вида ?w=… открыта в обычном браузере — отправляем в Telegram.
  // Ссылки startapp приходят только из Telegram, их не трогаем, иначе будет цикл.
  if (puzzle && isBrowserLink(code) && BOT_USERNAME && APP_SHORT_NAME) {
    location.replace(buildLink(code));
    return;
  }

  // Словарь грузим заранее, чтобы проверка попыток была мгновенной
  loadDictionary().catch(() => {});

  if (tg) tg.BackButton.onClick(() => showCreate());

  // Без ссылки на слово продолжаем незаконченную игру с собой, если она есть
  const soloCode = storageGet('nbukv:solo');
  const solo = !puzzle && soloCode && decodePuzzle(soloCode);
  const soloSaved = solo && storageGet(`nbukv:${soloCode}`);
  const resumeSolo = solo && !(soloSaved && soloSaved.finished);

  const rules = initRules();
  if (puzzle) {
    showPlay(code, puzzle.word, puzzle.author);
    if (!rules.seen()) rules.open();
  } else if (resumeSolo) {
    showPlay(soloCode, solo.word, '', { solo: true });
  } else {
    showCreate();
    if (code) $('create-error').textContent = 'Ссылка повреждена — не удалось прочитать слово.';
  }
}

init();
