// Hareket kestirimi (Karar 3): yerçekimi takibi, eksenel ivme, sızdırılan hız,
// durağanlık. Saf modül; her örnekte bir kez process() çağrılır.

import * as T from './thresholds.js';
import { SAMPLE_PERIOD_MS } from './protocol.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const std = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

export const DEFAULT_CALIBRATION = {
  gyroBias: [0, 0, 0],
  gravity: null,                        // null: ilk örnekten alınır
  accNoise: T.ACC_NOISE_DEFAULT,        // eksen başına ivme gürültüsü (std)
  accMagNoise: T.ACC_NOISE_DEFAULT,     // |acc| gürültüsü (std)
  gyroNoise: T.GYRO_NOISE_DEFAULT,      // eksen başına açısal hız gürültüsü (std)
  axis: [1, 0, 0],                      // sopanın ekseni (sensör çerçevesinde)
  axisSign: 1,                          // çekerek yay artı olsun diye
  axisOffset: 0,                        // m/s², eksen ofseti kalibrasyonu
  axisScale: 1,
};

// Dinlenme kalibrasyonu: sopa 2 sn tahtanın üstünde dururken alınan örneklerden.
export function calibrateRest(samples) {
  if (samples.length < 20) throw new Error('Dinlenme kalibrasyonu için en az 20 örnek gerekir');
  const axisStd = (key, i) => std(samples.map((s) => s[key][i]));
  const rmsOf = (key) => Math.sqrt(mean([0, 1, 2].map((i) => axisStd(key, i) ** 2)));
  return {
    gyroBias: [0, 1, 2].map((i) => mean(samples.map((s) => s.gyro[i]))),
    gravity: [0, 1, 2].map((i) => mean(samples.map((s) => s.acc[i]))),
    accNoise: Math.max(0.005, rmsOf('acc')),
    accMagNoise: Math.max(0.005, std(samples.map((s) => norm(s.acc)))),
    gyroNoise: Math.max(0.001, rmsOf('gyro')),
  };
}

export function createMotion(calibration = {}) {
  const c = { ...DEFAULT_CALIBRATION, ...calibration };
  const N = Math.round(T.STILL_WINDOW_MS / SAMPLE_PERIOD_MS); // 12 örnek
  const win = [];
  let g = c.gravity ? [...c.gravity] : null;
  let v = 0;
  let prevT = null;
  let stillSince = null;

  // Örneği yerinde tamamlar: gyro'dan sapmayı çıkarır, v, still, still_since, a_ax ekler.
  function process(s) {
    let dt = prevT === null ? SAMPLE_PERIOD_MS / 1000 : (s.t - prevT) / 1000;
    prevT = s.t;
    if (dt > 0.05) { v = 0; dt = SAMPLE_PERIOD_MS / 1000; } // veri kesildi: hızı sıfırla

    const w = sub(s.gyro, c.gyroBias);
    s.gyro = w;
    if (g === null) g = [...s.acc];

    // 1. Yerçekimi takibi: dünyaya sabit vektör, gövde çerçevesinde g × ω ile döner.
    const dg = cross(g, w);
    g = [g[0] + dg[0] * dt, g[1] + dg[1] * dt, g[2] + dg[2] * dt];

    const lin = sub(s.acc, g);
    win.push({ mag: norm(s.acc), lin: norm(lin), w: norm(w) });
    if (win.length > N) win.shift();

    // Durağanlık: |acc|'nin std'si (plan) + yerçekimsiz ivmenin ortalaması (sabit
    // ivmeyi yakalar) + açısal hızın ortalaması, hepsi gürültünün K katının altında.
    const K = T.STILL_K;
    const still = win.length === N
      && std(win.map((x) => x.mag)) < K * c.accMagNoise
      && mean(win.map((x) => x.lin)) < K * c.accNoise
      && mean(win.map((x) => x.w)) < K * c.gyroNoise;

    if (still) { // yalnızca durağanken ivmeölçere doğru çek
      g = [0, 1, 2].map((i) => g[i] + T.GRAVITY_RATE * (s.acc[i] - g[i]));
    }

    // 2. Eksenel ivme
    const a_ax = (dot(lin, c.axis) * c.axisSign - c.axisOffset) * c.axisScale;

    // 3. Hız: toplam, 3 sn zaman sabitiyle sıfıra sızar.
    v = v * Math.exp(-dt / T.LEAK_TAU_S) + a_ax * dt;

    // 4. Sıfırlama: durağanlık pencerenin başında başlamış sayılır.
    if (still) {
      if (stillSince === null) stillSince = s.t - T.STILL_WINDOW_MS;
      if (s.t - stillSince >= T.T_PAUSE_MS) v = 0;
    } else {
      stillSince = null;
    }

    s.a_ax = a_ax;
    s.v = v;
    s.still = still;
    s.still_since = stillSince;
    return s;
  }

  return { process, get gravity() { return g; } };
}
