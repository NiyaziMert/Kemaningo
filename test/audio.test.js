import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  midiToFreq, speedToLevel, levelToCutoff, createBeatClock, LEVEL_MIN, CUTOFF_MIN, CUTOFF_MAX,
} from '../web/audio.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('midiToFreq: A4 = 440 Hz, G3 ≈ 196 Hz', () => {
  close(midiToFreq(69), 440);
  close(midiToFreq(55), 196.0, 0.01);
});

test('speedToLevel: 0,5 m/s\'ye bölünür, [0,25, 1] aralığına sıkıştırılır', () => {
  assert.equal(speedToLevel(0), LEVEL_MIN);
  assert.equal(speedToLevel(0.1), LEVEL_MIN);
  assert.equal(speedToLevel(0.25), 0.5);
  assert.equal(speedToLevel(-0.25), 0.5); // iterek yay da aynı düzey
  assert.equal(speedToLevel(0.5), 1);
  assert.equal(speedToLevel(2), 1);
});

test('levelToCutoff: 0 → 1,5 kHz, 1 → 5 kHz, tekdüze artan', () => {
  close(levelToCutoff(0), CUTOFF_MIN);
  close(levelToCutoff(1), CUTOFF_MAX);
  let prev = 0;
  for (let l = 0; l <= 1; l += 0.05) {
    const c = levelToCutoff(l);
    assert.ok(c > prev);
    prev = c;
  }
});

test('metronom: 60 vuruş/dk, 2 dakikada 120 vuruş, kayma yok', () => {
  const start = 0.1;
  const clock = createBeatClock({ bpm: 60, beatsPerBar: 4, startTime: start });
  const beats = [];
  // Düzensiz uyanan zamanlayıcıyı taklit et: 25 ms ± 20 ms.
  let now = 0;
  while (now < start + 120) {
    beats.push(...clock.take(Math.min(now + 0.1, start + 120)));
    now += 0.025 + (Math.random() - 0.5) * 0.04;
  }
  assert.equal(beats.length, 120);
  beats.forEach((b, i) => {
    assert.equal(b.n, i);
    close(b.time, start + i); // her vuruş tam yerinde
    assert.equal(b.accent, i % 4 === 0);
  });
});

import { nearestSample, bakeLoop, normalizeGain, SAMPLE_NOTES, SAMPLE_LOOP } from '../web/audio.js';
import { existsSync } from 'node:fs';

test('nearestSample: G3–B5 aralığında en çok ±2 yarım ses kaydırma', () => {
  for (let m = 55; m <= 83; m++) {
    const s = nearestSample(m);
    assert.ok(Math.abs(Math.log2(s.rate) * 12) <= 2 + 1e-9, `${m}: ${s.name} oran ${s.rate}`);
  }
  assert.deepEqual(nearestSample(69), { name: 'A4', midi: 69, rate: 1 });
  assert.equal(nearestSample(71).name, 'C5'); // B4: C5'e 1, A4'e 2 yarım ses
});

test('bakeLoop: döngü sonu, döngü başının hemen öncesiyle sürekli birleşir', () => {
  const sr = 1000;
  const data = Float32Array.from({ length: 8500 }, (_, i) => Math.sin(i * 0.37) + (i / 8500));
  const orig = Float32Array.from(data);
  bakeLoop(data, sr, SAMPLE_LOOP);
  const s0 = SAMPLE_LOOP.start * sr;
  const e0 = SAMPLE_LOOP.end * sr;
  // Son örnek tamamen döngü başının öncesindeki örneğe dönmüş olmalı.
  assert.ok(Math.abs(data[e0 - 1] - orig[s0 - 1]) < 0.01, `${data[e0 - 1]} ≉ ${orig[s0 - 1]}`);
  // Karışım bölgesinin başı ve döngü dışı değişmemiş olmalı.
  assert.equal(data[e0 - SAMPLE_LOOP.xfade * sr - 1], orig[e0 - SAMPLE_LOOP.xfade * sr - 1]);
  assert.equal(data[100], orig[100]);
});

test('normalizeGain: 0,5–3 sn arasının RMS değeri hedefe gelir', () => {
  const sr = 1000;
  const data = Float32Array.from({ length: 5000 }, (_, i) => 0.5 * Math.sin(i * 0.2));
  const k = normalizeGain(data, sr, 0.12);
  assert.ok(Math.abs(k * 0.5 / Math.SQRT2 - 0.12) < 0.005, `k ${k}`);
});

test('her örnek dosyası projede var', () => {
  for (const [name] of SAMPLE_NOTES) {
    assert.ok(existsSync(new URL(`../web/samples/violin/${name}.wav`, import.meta.url)), name);
  }
});
