import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, checkNote, possessive } from '../web/rules.js';

const BEAT = 1000; // 60 vuruş/dk

// Kusursuz bir kayıt; alanlar override ile değiştirilir.
function rec(index, o = {}) {
  const start_beat = o.start_beat ?? index - 1;
  return {
    index,
    expected: { string: o.string ?? 2, bow: o.bow ?? (index % 2 ? 'D' : 'U'), midi: 69, start_beat, dur_beats: 1 },
    onset_ms: start_beat * BEAT,
    timing_error_ms: 0,
    wrong_strokes: [],
    neighbor_ms: 0,
    neighbor_string: null,
    bow_dir: o.bow ?? (index % 2 ? 'D' : 'U'),
    dir_conf: 0.95,
    dur_ms: 800,
    accel_rms: 0.2,
    gap_count: 0,
    max_gap_ms: 0,
    ...o,
  };
}
const check = (r, prev, opts = {}) => checkNote(r, prev, { beatMs: BEAT, useImu: true, dirCalibrated: true, ...opts });
const errorsOf = (r, prev, opts) => check(r, prev, opts).errors;

test('kusursuz kayıt bulgu vermez', () => {
  const recs = [1, 2, 3, 4].map((i) => rec(i));
  const r = evaluate(recs, { bpm: 60, useImu: true });
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.notes_clean, 4);
  assert.deepEqual(r.summary.not_evaluated, { timing: 0, bow_dir: 0, bow_speed: 0 });
});

test('yanlış tel: liste boş değilse', () => {
  assert.deepEqual(errorsOf(rec(2, { wrong_strokes: [{ string: 1, dur_ms: 300 }], timing_error_ms: null }), rec(1)),
    ['wrong_string']);
});

test('komşu tele değme: 14 ms hayır, 15 ms evet', () => {
  assert.deepEqual(errorsOf(rec(2, { neighbor_ms: 14 }), rec(1)), []);
  assert.deepEqual(errorsOf(rec(2, { neighbor_ms: 15 }), rec(1)), ['neighbor_touch']);
});

test('erken/geç: tolerans 80 ms ile aralığın %12\'sinden büyük olanı', () => {
  // 1 vuruş = 1000 ms → tolerans 120
  assert.deepEqual(errorsOf(rec(2, { timing_error_ms: 120 }), rec(1)), []);
  assert.deepEqual(errorsOf(rec(2, { timing_error_ms: 121 }), rec(1)), ['late']);
  assert.deepEqual(errorsOf(rec(2, { timing_error_ms: -120 }), rec(1)), []);
  assert.deepEqual(errorsOf(rec(2, { timing_error_ms: -121 }), rec(1)), ['early']);
  // 2 vuruşluk aralık → tolerans 240
  assert.deepEqual(errorsOf(rec(2, { start_beat: 2, timing_error_ms: 200 }), rec(1)), []);
  // ilk nota: aralık yerine bir vuruş → 120
  assert.deepEqual(errorsOf(rec(1, { timing_error_ms: 121 }), undefined), ['late']);
  // 120 vuruş/dk: 500 ms aralık → %12 = 60, alt sınır 80
  const fast = (e) => checkNote(rec(2, { timing_error_ms: e }), rec(1), { beatMs: 500, useImu: true }).errors;
  assert.deepEqual(fast(80), []);
  assert.deepEqual(fast(81), ['late']);
});

test('zamanlama değerlendirilmez: yanlış tel araya girdiyse ya da gecikme 2 vuruştan uzunsa', () => {
  const a = check(rec(2, { timing_error_ms: null, wrong_strokes: [{ string: 1, dur_ms: 200 }] }), rec(1));
  assert.ok(a.notEvaluated.includes('timing'));
  assert.ok(!a.errors.includes('late'));
  const b = check(rec(2, { timing_error_ms: 2001 }), rec(1));
  assert.ok(b.notEvaluated.includes('timing'));
  assert.deepEqual(b.errors, []);
  assert.deepEqual(errorsOf(rec(2, { timing_error_ms: 2000 }), rec(1)), ['late']);
});

test('ters yay: dir_conf 0,8 ve üstünde; altı değerlendirilmez', () => {
  assert.deepEqual(errorsOf(rec(2, { bow_dir: 'D', dir_conf: 0.8 }), rec(1)), ['wrong_bow_dir']);
  const low = check(rec(2, { bow_dir: 'D', dir_conf: 0.79 }), rec(1));
  assert.deepEqual(low.errors, []);
  assert.ok(low.notEvaluated.includes('bow_dir'));
});

test('ters yay ve düzensiz hız: IMU kapalıysa ya da yön kalibrasyonu yoksa değerlendirilmez', () => {
  const r = rec(2, { bow_dir: 'D', accel_rms: 2 });
  const off = check(r, rec(1), { useImu: false });
  assert.deepEqual(off.errors, []);
  assert.deepEqual(off.notEvaluated.sort(), ['bow_dir', 'bow_speed']);
  const nocal = check(r, rec(1), { dirCalibrated: false });
  assert.deepEqual(nocal.errors, ['uneven_speed']);
  assert.ok(nocal.notEvaluated.includes('bow_dir'));
});

test('düzensiz hız: 0,70 hayır, 0,71 evet; 400 ms\'den kısa çekiş değerlendirilmez', () => {
  assert.deepEqual(errorsOf(rec(2, { accel_rms: 0.7 }), rec(1)), []);
  assert.deepEqual(errorsOf(rec(2, { accel_rms: 0.71 }), rec(1)), ['uneven_speed']);
  const short = check(rec(2, { accel_rms: 2, dur_ms: 399 }), rec(1));
  assert.deepEqual(short.errors, []);
  assert.ok(short.notEvaluated.includes('bow_speed'));
  assert.deepEqual(errorsOf(rec(2, { accel_rms: 2, dur_ms: 400 }), rec(1)), ['uneven_speed']);
});

test('art arda 3 ters yön tek bulgu: "şu notadan itibaren"', () => {
  const flip = (i) => rec(i, { bow_dir: i % 2 ? 'U' : 'D' });
  const recs = [rec(1), rec(2), flip(3), flip(4), flip(5), rec(6), flip(8 - 1)];
  const r = evaluate(recs, { bpm: 60, useImu: true });
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.type, 'wrong_bow_dir');
  assert.equal(f.count, 4);
  assert.equal(f.shift_from, 3);
  assert.match(f.fact, /^3\. notadan itibaren yay yönün kaydı/);
  // Ayrık iki ters yön: kayma yok.
  const r2 = evaluate([rec(1), flip(2), rec(3), flip(4)], { bpm: 60, useImu: true });
  assert.equal(r2.findings[0].shift_from, undefined);
  assert.equal(r2.findings[0].fact, '2 notada (2, 4) yay yönün tersti.');
});

test('plandaki örnek: komşu tel bulgusunun olgu cümlesi', () => {
  const pattern = [1, 1, 2, 2]; // Re Re La La
  const recs = Array.from({ length: 16 }, (_, k) => {
    const i = k + 1;
    const touch = [3, 7, 11, 15].includes(i);
    return rec(i, { string: pattern[k % 4], neighbor_ms: touch ? 35 : 0, neighbor_string: touch ? 1 : null });
  });
  const f = evaluate(recs, { bpm: 60, useImu: true }).findings[0];
  assert.equal(f.type, 'neighbor_touch');
  assert.equal(f.avg_ms, 35);
  assert.equal(f.at_string_change, 4);
  assert.equal(f.fact,
    '4 notada (3, 7, 11, 15) La telini çalarken Re teline de değdin; ortalama 35 ms. Hepsi tel değiştirdiğin notalar.');
});

test('bulgular: en çok nota önce; eşitlikte yanlış tel, ters yön, komşu, geç, erken, düzensiz', () => {
  const recs = [
    rec(1, { timing_error_ms: 200 }),                           // geç
    rec(2, { timing_error_ms: 200 }),                           // geç
    rec(3, { neighbor_ms: 20, neighbor_string: 1 }),            // komşu
    rec(4, { wrong_strokes: [{ string: 3, dur_ms: 150 }], timing_error_ms: null }), // yanlış tel
    rec(5, { accel_rms: 1 }),                                   // düzensiz
  ];
  const r = evaluate(recs, { bpm: 60, useImu: true });
  assert.deepEqual(r.findings.map((f) => `${f.id}:${f.type}`),
    ['F1:late', 'F2:wrong_string', 'F3:neighbor_touch', 'F4:uneven_speed']);
  assert.equal(r.findings[1].fact, '1 notada yanlış tele çektin: 4. notada La yerine Mi.');
  assert.equal(r.summary.notes_with_error, 5);
  assert.equal(r.summary.not_evaluated.timing, 1);
});

test('çalınmayan notalar sayılmaz', () => {
  const recs = [rec(1), rec(2), rec(3, { onset_ms: null, timing_error_ms: null })];
  const r = evaluate(recs, { bpm: 60, useImu: true });
  assert.equal(r.summary.notes_played, 2);
  assert.deepEqual(r.summary.not_evaluated, { timing: 0, bow_dir: 0, bow_speed: 0 });
});

test('Türkçe iyelik eki', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 20, 30, 40, 100].map(possessive),
    ["1'i", "2'si", "3'ü", "4'ü", "5'i", "6'sı", "7'si", "8'i", "9'u", "10'u", "12'si", "20'si", "30'u", "40'ı", "100'ü"]);
});
