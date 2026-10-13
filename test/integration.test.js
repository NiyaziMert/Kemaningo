// Uçtan uca: sentetik S satırı → motion → strokes → session → rules.
// Bitti ölçütü (Aşama 6): bilerek yapılan her hata türü doğru bulgu olarak çıkar;
// kusursuz kayıt 0 bulgu verir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSong } from '../web/song.js';
import { createSession } from '../web/session.js';
import { evaluate } from '../web/rules.js';
import { synth, run, songSegments, REST, LIFT, LA, RE } from './fixtures.js';

const load = (id) => parseSong(JSON.parse(readFileSync(new URL(`../web/songs/${id}.json`, import.meta.url))));
const audio = { noteOn() {}, noteOff() {}, setLevel() {} };
const V = 0.3;

// Dört dörtlük La notası: D U D U.
const four = parseSong({
  id: 't', title: 'T', bpm: 60, beats_per_bar: 4, level: 1, targets: [],
  notes: [['A4', 1], ['A4', 1], ['A4', 1], ['A4', 1]],
});

function attempt(song, segments, synthOpts = {}) {
  const session = createSession({ song, audio });
  session.start(REST.ms);
  run(synth(segments, synthOpts), { getExpected: session.getExpected, onEvent: session.handle });
  assert.equal(session.state, 'done', 'deneme bitmedi');
  return evaluate(session.records, { bpm: song.bpm, useImu: true, dirCalibrated: true });
}
const types = (r) => r.findings.map((f) => f.type).sort();

test('kusursuz kayıt 0 bulgu verir (Daha Dün Annemizin, Komşu tel geçişleri)', () => {
  for (const id of ['daha_dun', 'gecis_komsu']) {
    const song = load(id);
    const r = attempt(song, songSegments(song));
    assert.deepEqual(r.findings, [], `${id}: ${r.findings.map((f) => f.fact).join(' | ')}`);
  }
});

test('yanlış tel', () => {
  const r = attempt(four, songSegments(four, { before: { 3: [{ ms: 300, mask: RE, v: V }] } }));
  assert.deepEqual(types(r), ['wrong_string']);
  assert.deepEqual(r.findings[0].notes, [3]);
});

test('komşu tele değme', () => {
  const r = attempt(four, songSegments(four), { extra: [[REST.ms + 2400, 30, RE]] });
  assert.deepEqual(types(r), ['neighbor_touch']);
  assert.deepEqual(r.findings[0].notes, [3]);
});

test('geç giriş: 3. nota 250 ms geç', () => {
  const r = attempt(four, [REST, { ms: 1000, mask: LA, v: V }, { ms: 1250, mask: LA, v: -V },
    { ms: 750, mask: LA, v: V }, { ms: 1000, mask: LA, v: -V }, LIFT]);
  assert.deepEqual(types(r), ['late']);
  assert.deepEqual(r.findings[0].notes, [3]);
});

test('erken giriş: 3. nota 250 ms erken', () => {
  const r = attempt(four, [REST, { ms: 1000, mask: LA, v: V }, { ms: 750, mask: LA, v: -V },
    { ms: 1250, mask: LA, v: V }, { ms: 1000, mask: LA, v: -V }, LIFT]);
  assert.deepEqual(types(r), ['early']);
  assert.deepEqual(r.findings[0].notes, [3]);
});

test('ters yay yönü: 2–4. notalar ters → "şu notadan itibaren"', () => {
  // D, sonra kaldır-koy ile yine D, sonra U, D: 2, 3, 4 ters. Sopa havada 150 ms'den uzun
  // durur; daha kısa kaldır-koyda hız sıfırlanmaz, sızıntı artığı yeni çekişin ilk
  // 200 ms'sine düşer, dir_conf 0,8'in altına iner ve nota değerlendirilmez.
  const r = attempt(four, [REST, { ms: 680, mask: LA, v: V }, { ms: 320, v: 0, ramp: 60 },
    { ms: 1000, mask: LA, v: V }, { ms: 1000, mask: LA, v: -V }, { ms: 1000, mask: LA, v: V }, LIFT]);
  assert.deepEqual(types(r), ['wrong_bow_dir']);
  assert.equal(r.findings[0].shift_from, 2);
});

test('düzensiz yay hızı: 2. notada hız 0,15 ile 0,45 m/s arasında dalgalanır', () => {
  const wobble = [];
  for (let k = 0; k < 8; k++) wobble.push({ ms: 125, mask: LA, v: k % 2 ? -0.15 : -0.45, ramp: 125 });
  const r = attempt(four, [REST, { ms: 1000, mask: LA, v: V }, ...wobble,
    { ms: 1000, mask: LA, v: V }, { ms: 1000, mask: LA, v: -V }, LIFT]);
  assert.deepEqual(types(r), ['uneven_speed']);
  assert.deepEqual(r.findings[0].notes, [2]);
});
