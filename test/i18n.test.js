// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, and the four documentation files, with the same sections. German says
// "du", never the polite "Sie". (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ERROR_KINDS } from '../src/blink/errors.js';
import { LANGUAGES } from '../src/config.js';
import { NAMES } from '../src/devices.js';
import {
  COMMAND_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  INIT_FAILED,
  REPORT_TEXT,
} from '../src/texts.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  badge: 16,
  caption: 80,
  status: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  const language = manifest.config_schema.find((field) => field.key === 'language');
  assert.deepEqual(
    language.options.map((option) => option.value),
    LANGS,
  );
  assert.equal(language.default, 'fr');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 50, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the brand, the same in every language', () => {
  assert.equal(manifest.name, 'Blink');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every message table of the code has the four languages', () => {
  // Widget texts shown as badges, rows or buttons are short; the others are messages.
  const widgetMessages = new Set(['notConnected', 'noDevice', 'unknown', 'updateGladys']);
  const widgetCaptions = new Set(['chooseSystem']);
  const widgetBadges = new Set(['motion', 'offline', 'detectionOff']);
  const widgetStatus = new Set(['syncOffline', 'batteryLow', 'waiting', 'armed', 'disarmed']);
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(ERROR_TEXT).flatMap(([key, value]) =>
      problems(value, `ERROR_TEXT.${key}`, 120),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(
        value,
        `TEXT.${key}`,
        widgetMessages.has(key)
          ? MAX.message
          : widgetCaptions.has(key)
            ? MAX.caption
            : widgetBadges.has(key)
              ? MAX.badge
              : widgetStatus.has(key)
                ? MAX.status
                : MAX.short,
      ),
    ),
  ];
  assert.deepEqual(found, []);
  assert.deepEqual(sorted(Object.keys(ERROR_TEXT)), sorted(Object.values(ERROR_KINDS)));
});

test('the feature names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
});

test('the reports and command messages exist in every language, toasts within 200 characters', () => {
  // The longest names a user may give, and the longest reason.
  const longName = 'Caméra de la porte du garage';
  const longReason = Object.values(ERROR_TEXT)
    .flatMap((text) => Object.values(text))
    .sort((a, b) => b.length - a.length)[0];
  const render = (value) =>
    typeof value === 'function' ? value(value.length === 2 ? 12 : longReason, 12) : value;
  assert.deepEqual(tableProblems(REPORT_TEXT, 'REPORT_TEXT', MAX.message, render), []);
  const renderCommand = (value) =>
    typeof value === 'function'
      ? value.length === 2
        ? value(longName, 59)
        : value(/reason/.test(value.toString()) ? longReason : longName)
      : value;
  assert.deepEqual(tableProblems(COMMAND_TEXT, 'COMMAND_TEXT', MAX.message, renderCommand), []);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre Kamera', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[1].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[1].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 10);
});

test('the guard catches a documentation with a missing section', () => {
  const shorter = docs.fr.replace(/\n## [^\n]+\n/, '\n');
  assert.notDeepEqual(headings(shorter), headings(docs.en));
});

test('the documentation names every action, trigger, widget button and feature', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    for (const item of [
      ...manifest.actions,
      ...manifest.scene_triggers,
      ...manifest.scene_actions,
    ]) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
    }
    for (const key of ['arm', 'disarm', 'snapshot']) {
      assert.ok(doc.includes(TEXT[key][lang]), `docs/${lang}.md: "${TEXT[key][lang]}"`);
    }
    for (const name of Object.values(NAMES[lang])) {
      assert.ok(doc.includes(name), `docs/${lang}.md: feature "${name}"`);
    }
  }
});

test('the German documentation says "du"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
});

test('the documentation says it was developed without the hardware, and not affiliated', () => {
  assert.match(docs.en, /Developed without the hardware: feedback welcome/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /github\.com\/guim31\/gladys-blink\/issues/);
    assert.match(docs[lang], /Blink/);
    assert.match(docs[lang], /Amazon/);
  }
});
