import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, createParser, formatS, createRateMeter, G } from '../web/protocol.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function collect() {
  const samples = [];
  const health = [];
  const p = createParser({ onSample: (s) => samples.push(s), onHealth: (h) => health.push(h) });
  return { p, samples, health };
}

test('geçerli S satırı: plandaki örnek', () => {
  const { p, samples } = collect();
  p.push('S,8412345,4,-310,95,8120,14,-3,22', 1.5);
  assert.equal(samples.length, 1);
  const s = samples[0];
  assert.equal(s.mask, 4); // La
  assert.equal(s.t_host, 1.5);
  close(s.acc[2], (8120 / 8192) * G);
  close(s.gyro[0], (14 / 65.5) * (Math.PI / 180));
  assert.equal(s.v, null);
});

test('geçerli H satırı: eski (5 alan) ve şeritli (6 alan, touch_us)', () => {
  const { p, health } = collect();
  p.push('H,1000000,1.0,1,3', 0);
  assert.deepEqual(health[0], { t: 0, t_host: 0, fw: '1.0', imu_ok: true, i2c_err: 3, touch_us: null });
  p.push('H,2000000,0.9.0,0,0,412', 0);
  assert.equal(health[1].touch_us, 412);
});

test('parmaklı S satırı: 10 alan, fmask 0–15; eski 9 ve 13 alanlı satırlarda fmask null', () => {
  const { p, samples } = collect();
  p.push('S,5000,4,0,0,8192,0,0,0,4', 0);
  p.push('S,10000,4,0,0,8192,0,0,0', 0);
  p.push('S,15000,4,0,0,8192,0,0,0,21000,20500,30100,19800', 0);
  assert.deepEqual(samples.map((x) => x.fmask), [4, null, null]);
  assert.equal(samples[0].finger, 0);
  const bad = collect();
  bad.p.push('S,5000,4,0,0,8192,0,0,0,16', 0);     // fmask > 15
  bad.p.push('S,5000,4,0,0,8192,0,0,0,1,2,3', 0);  // 12 alan
  assert.equal(bad.p.stats.bad, 2);
});

test('eksik alanlı ve bozuk satırlar sayılır ve atlanır', () => {
  const { p, samples } = collect();
  const bad = [
    'S,8412345,4,-310,95,8120,14,-3',       // eksik alan
    'S,8412345,4,-310,95,8120,14,-3,22,7,1', // fazla alan (11)
    'S,84x2345,4,-310,95,8120,14,-3,22',    // sayı değil
    'S,8412345,16,0,0,0,0,0,0',             // mask > 15
    'S,8412345,4,40000,0,0,0,0,0',          // int16 dışı
    'S,8412345,4,1.5,0,0,0,0,0',            // tamsayı değil
    'H,100,1.0,2,0',                        // imu_ok 0/1 değil
  ];
  for (const l of bad) p.push(l, 0);
  p.push('ets Jun  8 2016 00:22:57', 0); // açılış mesajı: S/H değil
  p.push('', 0);                          // boş satır sayılmaz
  assert.equal(samples.length, 0);
  assert.deepEqual(p.stats, { s: 0, h: 0, bad: bad.length, other: 1 });
});

test('satır sonundaki \\r zararsız', () => {
  assert.equal(parseLine('S,5000,1,0,0,8192,0,0,0\r').type, 'S');
});

test('t_us 32 bit taşmasında saat kesintisiz ilerler', () => {
  const { p, samples } = collect();
  const top = 2 ** 32 - 3000;
  for (const t of [top, top + 2000 + 0, 2000, 7000]) {
    p.push(formatS({ t_us: t, mask: 0, raw: [0, 0, 0, 0, 0, 0] }), 0);
  }
  assert.deepEqual(samples.map((s) => s.t), [0, 2, 5, 10]);
});

test('formatS ile parseLine birbirinin tersi', () => {
  const f = { t_us: 123, mask: 9, raw: [-1, 2, -32768, 32767, 0, 5], fmask: 12 };
  const p = parseLine(formatS(f));
  assert.deepEqual({ t_us: p.t_us, mask: p.mask, raw: p.raw, fmask: p.fmask }, f);
});

test('rate meter: son 1 sn içindeki satır sayısı', () => {
  const m = createRateMeter(1000);
  for (let t = 0; t < 2000; t += 5) m.push(t);
  assert.equal(m.rate(1995), 200);
});
