import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMotion, calibrateRest } from '../web/motion.js';
import { G } from '../web/protocol.js';
import { synth, run, REST, LA } from './fixtures.js';

const sample = (t, acc, gyro = [0, 0, 0]) => ({ t, t_host: t, mask: 0, acc, gyro });

test('dinlenmede durağan, hız 0', () => {
  const { samples } = run(synth([{ ms: 1000 }]));
  assert.ok(samples.slice(20).every((s) => s.still));
  assert.ok(samples.every((s) => Math.abs(s.v) < 0.01));
});

test('0,3 m/s çekişte hız kestirimi gerçeğe yakın ve hareket durağan sayılmaz', () => {
  const { samples } = run(synth([REST, { ms: 500, mask: LA, v: 0.3 }]));
  const at = (t) => samples.find((s) => s.t === t);
  assert.ok(Math.abs(at(500).v - 0.3) < 0.05, `v ${at(500).v}`);
  assert.ok(samples.filter((s) => s.t > 320).every((s) => !s.still));
});

test('sabit ivmeli hareket durağan sayılmaz', () => {
  // Gürültüsüz, 1 m/s² sabit ivme: |acc|'nin std'si 0 ama yerçekimsiz ivme 1.
  const m = createMotion();
  for (let t = 0; t < 300; t += 5) m.process(sample(t, [0, 0, G]));
  let s;
  for (let t = 300; t < 400; t += 5) s = m.process(sample(t, [1, 0, G]));
  assert.equal(s.still, false);
});

test('jiroskop dönüşü yerçekimini izler: eğilen sopada eksenel ivme sahte hız üretmez', () => {
  const m = createMotion({ gravity: [0, 0, G] });
  const w = 0.5; // rad/s, y ekseni etrafında 0,5 sn → 0,25 rad eğim
  let s;
  for (let i = 0; i <= 100; i++) {
    const a = w * Math.min(i, 100) * 0.005;
    // dönen sensörde yerçekimi: x bileşeni -g·sin(a), z bileşeni g·cos(a)
    const gyro = i < 100 ? [0, w, 0] : [0, 0, 0];
    s = m.process(sample(i * 5, [-G * Math.sin(a), 0, G * Math.cos(a)], gyro));
  }
  assert.ok(Math.abs(s.v) < 0.02, `v ${s.v}`);
});

test('calibrateRest: sapma, yerçekimi ve gürültü', () => {
  const samples = Array.from({ length: 400 }, (_, i) => ({
    acc: [0.1 + (i % 2 ? 0.02 : -0.02), 0, G], gyro: [0.03, -0.01, 0.002],
  }));
  const c = calibrateRest(samples);
  assert.ok(Math.abs(c.gyroBias[0] - 0.03) < 1e-9);
  assert.ok(Math.abs(c.gravity[0] - 0.1) < 1e-9);
  assert.ok(c.accNoise > 0.005 && c.accNoise < 0.02);
  assert.equal(c.gyroNoise, 0.001); // alt sınır
});
