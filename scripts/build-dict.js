'use strict';
// Собирает words.txt для игры из словаря Harrix Russian-Nouns v2.0.
// Запуск: node scripts/build-dict.js <папка russian_nouns_v2.0>
//
// Оставляем существительные из 3–10 букв без дефисов, ё заменяем на е,
// выбрасываем слова, которые бывают только во множественном числе (ножницы, сани).

const fs = require('fs');
const path = require('path');

const MIN_LEN = 3;
const MAX_LEN = 10;

const dir = process.argv[2];
if (!dir) {
  console.error('Укажите папку russian_nouns_v2.0');
  process.exit(1);
}

const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/).filter(Boolean);

const definitions = {};
for (const line of read('russian_nouns_with_definition.txt')) {
  const i = line.indexOf(': ');
  if (i > 0) definitions[line.slice(0, i)] = line.slice(i + 2);
}

// Только множественное число: все омонимы помечены «мн.» и нет ни одного с родом
function pluralOnly(word) {
  const d = definitions[word] || '';
  const startsPlural = /^(\d+\. )?мн\./.test(d);
  const hasGender = /(^|\d+\. )(м|ж|ср)\./.test(d);
  return startsPlural && !hasGender;
}

const words = new Set();
let skippedPlural = 0;
for (const raw of read('russian_nouns.txt')) {
  if (!/^[а-яё]+$/.test(raw)) continue;
  const word = raw.replace(/ё/g, 'е');
  if (word.length < MIN_LEN || word.length > MAX_LEN) continue;
  if (pluralOnly(raw)) { skippedPlural++; continue; }
  words.add(word);
}

const sorted = [...words].sort((a, b) => a.localeCompare(b, 'ru'));
const out = path.join(__dirname, '..', 'words.txt');
fs.writeFileSync(out, sorted.join('\n') + '\n');
console.log(`words.txt: ${sorted.length} слов, убрано «только мн. ч.»: ${skippedPlural}`);

// ---------- Слова для случайной игры ----------
// Частотности в словаре нет, поэтому отбираем «узнаваемые» слова по косвенным признакам:
// без стилистических помет и производных толкований, и не меньше трёх значений
// (многозначные слова обычно и самые употребительные).
const RANDOM_MIN_LEN = 4;
const RANDOM_MAX_LEN = 8;
const RANDOM_MIN_SENSES = 3;
const MARKS = /(устар\.|местн\.|разг\.|сниж\.|нар\.-поэт\.|высок\.|книжн\.|прост\.|бран\.|груб\.|нескл\.|трад\.-поэт\.|церк\.|жарг\.|проф\.|спец\.)/;
const DERIVED = /(Уменьш\.|Ласк\.|Увелич\.|Уничиж\.|То же, что|см\.|Самка|Действие по знач|Процесс действия|Состояние по знач|Свойство по знач|Отвлеч\. сущ\.|Женск\. к|Житель|Представитель|Последователь|Соотносящийся|Сторонни)/;

function isCommon(raw) {
  const d = definitions[raw] || '';
  const first = d.replace(/^1\.\s*/, '').split(/\s2\.\s/)[0]; // первый омоним
  if (!/^(м|ж|ср)\.\s/.test(first)) return false;
  if (MARKS.test(first.slice(0, 40)) || DERIVED.test(first.slice(0, 80))) return false;
  const senses = Math.max((first.match(/(^|\s)\d\)\s/g) || []).length, 1);
  const homonyms = /\s2\.\s/.test(d) ? 1 : 0;
  return senses + homonyms >= RANDOM_MIN_SENSES;
}

const common = new Set();
for (const raw of read('russian_nouns.txt')) {
  if (!/^[а-яё]+$/.test(raw)) continue;
  const word = raw.replace(/ё/g, 'е');
  if (word.length < RANDOM_MIN_LEN || word.length > RANDOM_MAX_LEN) continue;
  if (words.has(word) && isCommon(raw)) common.add(word);
}
const commonSorted = [...common].sort((a, b) => a.localeCompare(b, 'ru'));
fs.writeFileSync(path.join(__dirname, '..', 'random.txt'), commonSorted.join('\n') + '\n');
console.log(`random.txt: ${commonSorted.length} слов (${RANDOM_MIN_LEN}–${RANDOM_MAX_LEN} букв)`);
