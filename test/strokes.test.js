import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synth, run, seeded, REST, LIFT, LA, RE } from './fixtures.js';
import { createSimEngine } from '../web/sources/simulator.js';

const V = 0.3; // m/s

function describe(r) { // hata mesajı için kısa özet
  return r.ends.map((e) => `#${e.id} s${e.string ?? ''} ${e.cause} ${e.dur_ms}ms ${e.confirmed ? '✓' : '✗'} ${e.dir}`)
    .join(' | ');
}

test('1. 30 ms boşluklu tek çekiş 1 çekiş verir', () => {
  const r = run(synth([REST, { ms: 1000, mask: LA, v: V }, LIFT], { gaps: [[800, 30]] }));
  assert.equal(r.starts.length, 1, describe(r));
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.ends[0].gap_count, 1);
  assert.ok(r.ends[0].max_gap_ms >= 25 && r.ends[0].max_gap_ms <= 35);
  assert.equal(r.ends[0].dir, 'D');
});

test('2. 30 ms boşluk ve yön değişimi 2 çekiş verir', () => {
  // Yön değişimi 900. ms'de başlar, 100 ms sürer; boşluk geçişin ortasında.
  const r = run(synth([REST, { ms: 600, mask: LA, v: V }, { ms: 600, mask: LA, v: -V }, LIFT],
    { gaps: [[935, 30]] }));
  assert.equal(r.starts.length, 2, describe(r));
  assert.equal(r.confirmed.length, 2);
  assert.deepEqual(r.confirmed.map((e) => e.dir), ['D', 'U']);
  assert.equal(r.starts[1].cause, 'reversal');
});

test('3. boşluksuz yön değişimi 2 çekiş verir', () => {
  const r = run(synth([REST, { ms: 600, mask: LA, v: V }, { ms: 600, mask: LA, v: -V }, LIFT]));
  assert.equal(r.starts.length, 2, describe(r));
  assert.equal(r.confirmed.length, 2);
  assert.deepEqual(r.confirmed.map((e) => e.dir), ['D', 'U']);
  assert.ok(r.confirmed[1].dir_conf >= 0.8, `dir_conf ${r.confirmed[1].dir_conf}`);
  // Yeni çekiş sıfır geçişinde başlar: 900 ms + ~40 ms.
  assert.ok(Math.abs(r.starts[1].t - 940) <= 25, `başlangıç ${r.starts[1].t}`);
});

test('4. aynı yönde 200 ms boşluk 2 çekiş verir', () => {
  const r = run(synth([REST, { ms: 1200, mask: LA, v: V }, LIFT], { gaps: [[800, 200]] }));
  assert.equal(r.starts.length, 2, describe(r));
  assert.equal(r.confirmed.length, 2);
  assert.equal(r.ends[0].cause, 'gap');
  assert.equal(r.starts[1].cause, 'contact');
});

test('5. 20 ms komşu tel teması 1 çekiş verir ve other_ms dolar', () => {
  const r = run(synth([REST, { ms: 800, mask: LA, v: V }, LIFT], { extra: [[700, 20, RE]] }));
  assert.equal(r.starts.length, 1, describe(r));
  const other = r.ends[0].other_ms;
  assert.ok(other[1] >= 20 && other[1] <= 30, `other_ms ${other}`);
  assert.equal(other[0] + other[2] + other[3], 0);
});

test('6. tel devri 2 çekiş verir', () => {
  const r = run(synth([REST, { ms: 500, mask: LA, v: V }, { ms: 500, mask: RE, v: V }, LIFT]));
  assert.equal(r.starts.length, 2, describe(r));
  assert.equal(r.confirmed.length, 2);
  assert.deepEqual(r.starts.map((e) => e.string), [2, 1]);
  assert.equal(r.starts[1].cause, 'string_change');
  assert.equal(r.starts[1].t, 800); // devir, yeni telin ilk temas anına yazılır
});

test('7. telde 200 ms durma 2 çekiş verir', () => {
  const r = run(synth([
    REST, { ms: 500, mask: LA, v: V }, { ms: 250, mask: LA, v: 0, ramp: 50 },
    { ms: 500, mask: LA, v: V }, LIFT,
  ]));
  assert.equal(r.confirmed.length, 2, describe(r));
  assert.equal(r.ends[0].cause, 'pause');
  assert.equal(r.starts[1].cause, 'resume');
  assert.deepEqual(r.confirmed.map((e) => e.dir), ['D', 'D']);
});

test('8. 0,1 m/s² sapmalı 2 sn çekiş 1 çekiş verir ve yönü doğrudur', () => {
  for (const bias of [-0.1, 0.1]) {
    const r = run(synth([REST, { ms: 2000, mask: LA, v: V }, LIFT], { bias }));
    assert.equal(r.starts.length, 1, `bias ${bias}: ${describe(r)}`);
    assert.equal(r.confirmed[0].dir, 'D');
  }
});

test('9. 50 ms temas kesinleşen çekiş vermez', () => {
  const r = run(synth([REST, { ms: 300, v: V }, { ms: 50, mask: LA, v: V }, { ms: 300, v: V }, LIFT]));
  assert.equal(r.confirms.length, 0, describe(r));
  assert.equal(r.confirmed.length, 0);
  assert.ok(r.ends.every((e) => !e.confirmed));
});

test('10. 2 sn çekişin sonunda telde durma ikinci çekiş vermez', () => {
  const r = run(synth([REST, { ms: 2000, mask: LA, v: V }, { ms: 500, mask: LA, v: 0 }, LIFT]));
  assert.equal(r.confirmed.length, 1, describe(r));
  assert.equal(r.confirms.length, 1);
});

test('10b. 3 sn çekişte sızıntı sahte yön değişimi yaratsa da ikinci çekiş kesinleşmez', () => {
  const r = run(synth([REST, { ms: 3000, mask: LA, v: V }, { ms: 500, mask: LA, v: 0 }, LIFT]));
  assert.equal(r.confirmed.length, 1, describe(r));
  assert.equal(r.confirms.length, 1);
});

test('sopa telde dururken nota çıkmaz', () => {
  const r = run(synth([REST, { ms: 3000, mask: LA, v: 0 }]));
  assert.equal(r.starts.length, 0, describe(r));
});

test('simülatör: temas gürültüsü açıkken 20 çekiş 20 stroke_start', () => {
  const e = createSimEngine({ rng: seeded(11) });
  e.options.contactNoise = true;
  const lines = [];
  for (let i = 0; i < 60; i++) lines.push(e.next()); // 300 ms dinlenme
  e.input.mask = LA;
  for (let k = 0; k < 20; k++) {
    e.input.dir = k % 2 === 0 ? 1 : -1;
    for (let i = 0; i < 120; i++) lines.push(e.next()); // 600 ms
  }
  e.input.mask = 0;
  e.input.dir = 0;
  for (let i = 0; i < 100; i++) lines.push(e.next());
  const r = run(lines);
  assert.equal(r.starts.length, 20, describe(r));
  assert.equal(r.confirmed.length, 20);
  assert.ok(r.confirmed.every((s, k) => s.dir === (k % 2 === 0 ? 'D' : 'U')), describe(r));
});

test('yalnızca temas kipi: temasla başlar, boşlukla biter, yön yok', () => {
  const r = run(synth([REST, { ms: 400, mask: LA, v: 0 }, { ms: 200 }, { ms: 60, mask: LA }, LIFT]),
    { useImu: false });
  assert.equal(r.starts.length, 2, describe(r));
  assert.equal(r.confirmed.length, 1); // 60 ms'lik ikinci temas kesinleşmez
  assert.equal(r.confirmed[0].dir, null);
});
