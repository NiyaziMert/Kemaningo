// Sentetik S akışı üreten yardımcılar ve ayrıştırıcı → motion → strokes zinciri.

import { formatS, createParser, ACC_LSB_PER_G, G } from '../web/protocol.js';
import { createMotion } from '../web/motion.js';
import { createStrokeSegmenter } from '../web/strokes.js';
import { gaussian } from '../web/sources/simulator.js';

export const SOL = 1;
export const RE = 2;
export const LA = 4;
export const MI = 8;

// Tekrarlanabilir rastgelelik (mulberry32).
export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampInt16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
const GYRO_LSB_PER_RAD = 65.5 * (180 / Math.PI);

// segments: [{ ms, mask = 0, v = 0, ramp = 100 }]
//   Her segmentte hız, öncekinin son değerinden v'ye ramp ms'de doğrusal geçer.
// opts.gaps:  [[başlangıç ms, süre ms]] bu aralıkta bütün temas kalkar
// opts.extra: [[başlangıç ms, süre ms, mask]] bu aralıkta maskeye eklenir
// opts.bias:  hareket sırasında eksenel ivmeye eklenen sapma (m/s²)
// opts.noise: sensör gürültüsü (dinlenme 0,01, hareket 0,3 m/s²)
export function synth(segments, {
  gaps = [], extra = [], bias = 0, noise = true, seed = 1,
  restNoise = 0.01, moveNoise = 0.3,
} = {}) {
  const rng = seeded(seed);
  const total = segments.reduce((s, x) => s + x.ms, 0);
  const vel = new Float64Array(total + 1);
  const contact = new Uint8Array(total);
  let t = 0;
  let v0 = 0;
  for (const { ms, mask = 0, v = 0, ramp = 100 } of segments) {
    const r = Math.max(1, Math.min(ramp, ms));
    for (let i = 0; i < ms; i++) {
      vel[t + i + 1] = i + 1 >= r ? v : v0 + ((v - v0) * (i + 1)) / r;
      contact[t + i] = mask;
    }
    t += ms;
    v0 = v;
  }
  for (const [s, d] of gaps) for (let i = s; i < Math.min(total, s + d); i++) contact[i] = 0;
  for (const [s, d, m] of extra) for (let i = s; i < Math.min(total, s + d); i++) contact[i] |= m;

  const lines = [];
  for (let w = 0; w + 5 <= total; w += 5) {
    let mask = 0;
    for (let i = w; i < w + 5; i++) mask |= contact[i];
    const vTrue = vel[w + 5];
    const moving = Math.abs(vTrue) > 0.01;
    const acc = [(vel[w + 5] - vel[w]) / 0.005 + (moving ? bias : 0), 0, G];
    const gyro = [0, 0, 0];
    if (noise) {
      const an = moving ? moveNoise : restNoise;
      const gn = 0.001; // gyro gürültüsü harekette de sensör gürültüsüdür
      for (let i = 0; i < 3; i++) {
        acc[i] += an * gaussian(rng);
        gyro[i] += gn * gaussian(rng);
      }
    }
    lines.push(formatS({
      t_us: w * 1000,
      mask,
      raw: [...acc.map((a) => clampInt16((a / G) * ACC_LSB_PER_G)),
        ...gyro.map((x) => clampInt16(x * GYRO_LSB_PER_RAD))],
    }));
  }
  return lines;
}

// Satırları zincirden geçirir; olayları ve örnekleri döndürür.
export function run(lines, { useImu = true, getExpected, onEvent = () => {} } = {}) {
  const events = [];
  const samples = [];
  const motion = createMotion();
  const strokes = createStrokeSegmenter({
    onEvent: (e) => { events.push(e); onEvent(e); }, useImu, getExpected,
  });
  const parser = createParser({
    onSample: (s) => { motion.process(s); samples.push(s); strokes.push(s); },
  });
  lines.forEach((l, i) => parser.push(l, i * 5));
  const of = (type) => events.filter((e) => e.type === type);
  return {
    events,
    samples,
    starts: of('stroke_start'),
    ends: of('stroke_end'),
    confirmed: of('stroke_end').filter((e) => e.confirmed),
    confirms: of('stroke_confirm'),
  };
}

// Bir şarkıyı kusursuz çalan segmentler: her nota vuruşunda başlar, beklenen telde,
// beklenen yönde 0,3 m/s. Sus: sopa havada durur. before/after: araya eklenecek segmentler
// ({ [notaSırası]: [segment, ...] }), nota segmentinin önüne konur ve süresinden düşülür.
export function songSegments(song, { speed = 0.3, before = {} } = {}) {
  const beatMs = 60000 / song.bpm;
  const segs = [REST];
  for (const n of song.notes) {
    let ms = n.dur_beats * beatMs;
    for (const extra of before[n.index] ?? []) {
      segs.push(extra);
      ms -= extra.ms;
    }
    if (n.rest) segs.push({ ms, v: 0 });
    else segs.push({ ms, mask: 1 << n.string, v: n.bow === 'D' ? speed : -speed });
  }
  segs.push(LIFT);
  return segs;
}

// Başta 300 ms dinlenme: yerçekimi kestirimi ve durağanlık penceresi otursun.
export const REST = { ms: 300 };
export const LIFT = { ms: 300, v: 0 };
