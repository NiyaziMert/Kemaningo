import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimEngine, createSimulator } from '../web/sources/simulator.js';
import { createParser } from '../web/protocol.js';
import { createRecorder, parseRecording, replayAll, createReplayer } from '../web/sources/replay.js';

// Tekrarlanabilir rastgelelik (mulberry32).
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseAll(lines) {
  const samples = [];
  const p = createParser({ onSample: (s) => samples.push(s) });
  for (const l of lines) p.push(l, 0);
  return { samples, stats: p.stats };
}

test('tel ve ok tuşu basılıyken doğru maske ve sıfırdan farklı ivme', () => {
  const e = createSimEngine();
  e.input.mask = 1 << 2; // La
  e.input.dir = 1;       // çekerek
  const lines = Array.from({ length: 20 }, () => e.next());
  const { samples, stats } = parseAll(lines);
  assert.equal(stats.bad, 0);
  assert.ok(samples.every((s) => s.mask === 4));
  assert.ok(samples[0].acc[0] > 0.5, `ivme ${samples[0].acc[0]}`);
  assert.ok(samples.every((s) => Math.abs(s.acc[2] - 9.80665) < 1.5)); // z ≈ 1 g (titreşim gürültüsü)
  e.input.dir = 0; // bırakınca yavaşlar: ivme eksi
  assert.ok(parseAll([e.next()]).samples[0].acc[0] < 0);
});

test('t_us 5 ms adımlarla ilerler; dokunulmayınca mask 0', () => {
  const e = createSimEngine();
  const { samples } = parseAll([e.next(), e.next(), e.next()]);
  assert.deepEqual(samples.map((s) => s.t), [0, 5, 10]);
  assert.ok(samples.every((s) => s.mask === 0));
});

test('temas gürültüsü maskede boşluklar açar', () => {
  const e = createSimEngine({ rng: seeded(1) });
  e.options.contactNoise = true;
  e.input.mask = 1;
  const { samples } = parseAll(Array.from({ length: 2000 }, () => e.next()));
  const zeros = samples.filter((s) => s.mask === 0).length;
  assert.ok(zeros > 0 && zeros < 400, `boş örnek ${zeros}`);
});

test('sürücü: düzensiz uyanmada da 1 sn = 200 S satırı', () => {
  let t = 0;
  const lines = [];
  const sim = createSimulator({
    onLine: (l) => lines.push(l), now: () => t, schedule: () => 1, cancel: () => {}, keyTarget: null,
  });
  sim.start();
  const rng = seeded(7);
  while (t < 1000) { t = Math.min(1000, t + 1 + rng() * 15); sim.tick(); }
  assert.equal(lines.filter((l) => l.startsWith('S,')).length, 200);
  assert.equal(lines.filter((l) => l.startsWith('H,')).length, 1);
});

test('kayıt ile oynatma aynı örnek dizisini verir', () => {
  const e = createSimEngine({ rng: seeded(3) });
  e.options.contactNoise = true;
  e.options.speedJitter = true;
  const rec = createRecorder();
  const direct = [];
  const pDirect = createParser({ onSample: (s) => direct.push(s) });
  for (let i = 0; i < 600; i++) {
    e.input.mask = i < 300 ? 4 : 8;
    e.input.dir = i % 200 < 100 ? 1 : -1;
    const line = e.next();
    const tHost = i * 5 + 0.123;
    rec.push(line, tHost);
    pDirect.push(line, tHost);
  }
  const replayed = [];
  const pReplay = createParser({ onSample: (s) => replayed.push(s) });
  replayAll(parseRecording(rec.toText()), pReplay.push);
  assert.equal(replayed.length, 600);
  assert.deepEqual(replayed, direct);
});

test('tarayıcı oynatıcısı satır aralıklarını korur ve sonda durur', () => {
  let t = 1000;
  const got = [];
  let ended = false;
  const r = createReplayer({
    entries: parseRecording('# x\n10\tS,0,1,0,0,0,0,0,0\n15\tS,5000,1,0,0,0,0,0,0\n40\tS,30000,0,0,0,0,0,0,0\n'),
    onLine: (l, th) => got.push([l.split(',')[1], th]),
    onEnd: () => { ended = true; },
    now: () => t, schedule: () => 1, cancel: () => {},
  });
  r.start();
  r.tick();          // 0 ms: ilk satır
  t += 5; r.tick();  // 5 ms: ikinci
  t += 20; r.tick(); // 25 ms: üçüncü henüz değil
  assert.deepEqual(got.map((g) => g[0]), ['0', '5000']);
  t += 5; r.tick();  // 30 ms
  assert.deepEqual(got.map((g) => g[0]), ['0', '5000', '30000']);
  assert.equal(got[2][1], 1030); // aşağı akışa şimdiki zaman
  assert.ok(ended && !r.running);
});
