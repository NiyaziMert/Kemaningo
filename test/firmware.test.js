// Firmware mantığı bilgisayarda: yay.ino taklit Arduino ile derlenir ve çalıştırılır
// (test/firmware/host_main.cpp senaryosu). C++ derleyicisi yoksa test atlanır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLine } from '../web/protocol.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let output = null;
try {
  const bin = join(mkdtempSync(join(tmpdir(), 'yay-fw-')), 'fw_host');
  execFileSync('clang++', ['-std=c++17', '-Wall', '-Werror', '-I', join(root, 'test/firmware'),
    '-o', bin, join(root, 'test/firmware/host_main.cpp')], { stdio: 'pipe' });
  output = execFileSync(bin, { encoding: 'utf8' });
} catch (e) {
  if (e.code !== 'ENOENT') throw e; // derleyici var ama derleme hatası: test düşmeli
}
const skip = output === null ? 'clang++ bulunamadı' : false;

const T0 = 0xffffffff - 1500000;
const lines = () => output.trim().split('\n').map(parseLine);
const S = () => lines().filter((l) => l.type === 'S');
const msOf = (t_us) => ((t_us - T0 + 2 ** 32) % 2 ** 32) / 1000;

test('3 sn: 600 S ve 3 H satırı, hepsi geçerli', { skip }, () => {
  const all = lines();
  assert.ok(all.every((l) => l && l.type !== 'other'), 'bozuk ya da tanınmayan satır var');
  assert.equal(all.filter((l) => l.type === 'S').length, 600);
  const h = all.filter((l) => l.type === 'H');
  assert.equal(h.length, 3);
  assert.deepEqual([h[0].fw, h[0].imu_ok, h[0].i2c_err], ['0.10.0', false, 0]);
});

test('t_us farkları tam 5000 µs; micros() taşması ve 3 ms takılma atlama yaratmaz', { skip }, () => {
  const s = S();
  for (let i = 1; i < s.length; i++) {
    assert.equal((s[i].t_us - s[i - 1].t_us + 2 ** 32) % 2 ** 32, 5000, `satır ${i}`);
  }
  assert.ok(s.some((l, i) => i > 0 && l.t_us < s[i - 1].t_us), 'taşma senaryoda yok');
});

test('tek örneklik sıçrama temas sayılmaz; temas penceresi La bitinde', { skip }, () => {
  for (const l of S()) {
    const ms = msOf(l.t_us);           // pencerenin son örneği
    const touched = ms >= 1001 && ms <= 1503;
    if (ms > 1005 && ms < 1495) assert.equal(l.mask, 4, `${ms} ms`);
    if (!touched) assert.equal(l.mask, 0, `${ms} ms`);
  }
});

test('folyo: sopa La telindeyken 3. folyoya basılı → fmask 4 (3. parmak)', { skip }, () => {
  for (const l of S()) {
    const ms = msOf(l.t_us);
    assert.equal(typeof l.fmask, 'number', 'fmask alanı yok');
    if (ms > 1105 && ms < 1395 && !(ms >= 1198 && ms <= 1206)) assert.equal(l.fmask, 4, `${ms} ms`);
    if (ms < 1099 || ms > 1405) assert.equal(l.fmask, 0, `${ms} ms`);
  }
});

test('3 ms\'lik kesinti tarayıcıya ulaşmaz (5 ms penceresinde gizlenir)', { skip }, () => {
  const around = S().filter((l) => msOf(l.t_us) >= 1195 && msOf(l.t_us) <= 1210);
  assert.ok(around.length >= 3);
  assert.ok(around.every((l) => l.mask === 4));
});
