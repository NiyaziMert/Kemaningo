// Klavye simülatörü: kartla aynı S ve H satırlarını üretir (Karar 8).
// createSimEngine saftır; createSimulator klavyeyi ve zamanlayıcıyı bağlar.

import { formatS, formatH, ACC_LSB_PER_G, G, SAMPLE_PERIOD_MS } from '../protocol.js';

export const SIM_SPEED = 0.3;        // m/s, normal hareket
export const SIM_SPEED_FAST = 0.6;   // m/s, Shift basılıyken
export const SIM_TAU_S = 0.08;       // hızın hedefe yaklaşma zaman sabiti
export const GAP_PROB_PER_MS = 0.005; // temas gürültüsü: ortalama 200 ms'de bir boşluk
export const GAP_MIN_MS = 2;
export const GAP_MAX_MS = 30;
export const JITTER_AMP = 0.15;      // m/s, hız dalgalanması genliği
export const JITTER_HZ = 2;
// Sensör gürültüsü (eksen başına std). Sabit hızda ivme tam sıfır olursa hareket
// "durağan" görünür; gerçek sopada yay–tel sürtünmesi titreşim üretir.
export const REST_ACC_NOISE = 0.01;  // m/s²
export const REST_GYRO_NOISE = 0.001; // rad/s
export const MOVE_ACC_NOISE = 0.3;   // m/s², hareket halinde
export const MOVE_GYRO_NOISE = 0.001; // rad/s; titreşim dönüş değil, sensör gürültüsü aynı kalır
const GYRO_LSB_PER_RAD = 65.5 * (180 / Math.PI);

// Box–Muller: rng'den standart normal sayı.
export function gaussian(rng) {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const KEY_STRING = { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3 }; // Sol, Re, La, Mi
const KEY_FINGER = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 };


const clampInt16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));

export function createSimEngine({ rng = Math.random } = {}) {
  const options = { contactNoise: false, speedJitter: false, sensorNoise: true };
  const input = { mask: 0, dir: 0, fast: false, fingers: [] }; // dir: +1 çekerek, -1 iterek; fingers: basılı şeritler (1–4)
  let t_us = 0;
  let v = 0;
  let gapLeftMs = 0;
  let lines = 0;

  // Firmware gibi: içeride 1 kHz, 5 ms'de bir satır. Pencerede tek temas = bit 1.
  function next() {
    let mask = 0;
    let accSum = 0;
    for (let i = 0; i < SAMPLE_PERIOD_MS; i++) {
      const tS = (t_us + i * 1000) / 1e6;
      let target = input.dir * (input.fast ? SIM_SPEED_FAST : SIM_SPEED);
      if (options.speedJitter && input.dir !== 0) {
        target += input.dir * JITTER_AMP * Math.sin(2 * Math.PI * JITTER_HZ * tS);
      }
      const dv = (target - v) * (0.001 / SIM_TAU_S);
      v += dv;
      accSum += dv / 0.001;

      if (gapLeftMs > 0) gapLeftMs -= 1;
      else if (options.contactNoise && input.mask && rng() < GAP_PROB_PER_MS) {
        gapLeftMs = GAP_MIN_MS + Math.floor(rng() * (GAP_MAX_MS - GAP_MIN_MS + 1));
      }
      if (gapLeftMs === 0) mask |= input.mask;
    }
    // Sopa yatay: x = sopanın ekseni, z = 1 g, jiroskop yalnızca gürültü.
    const acc = [accSum / SAMPLE_PERIOD_MS, 0, G];
    const gyro = [0, 0, 0];
    if (options.sensorNoise) {
      const moving = Math.abs(v) > 0.01;
      const an = moving ? MOVE_ACC_NOISE : REST_ACC_NOISE;
      const gn = moving ? MOVE_GYRO_NOISE : REST_GYRO_NOISE;
      for (let i = 0; i < 3; i++) {
        acc[i] += an * gaussian(rng);
        gyro[i] += gn * gaussian(rng);
      }
    }
    const raw = [
      ...acc.map((a) => clampInt16((a / G) * ACC_LSB_PER_G)),
      ...gyro.map((w) => clampInt16(w * GYRO_LSB_PER_RAD)),
    ];
    // Folyo yalnızca sopanın değdiği tel ona bastırılınca LOW olur (gerçek devre gibi).
    const fmask = mask ? input.fingers.reduce((m, f) => m | (1 << (f - 1)), 0) : 0;
    const line = formatS({ t_us, mask, raw, fmask });
    t_us = (t_us + SAMPLE_PERIOD_MS * 1000) % 2 ** 32;
    lines += 1;
    return line;
  }

  const health = () => formatH({ t_us, fw: 'sim', imu_ok: true, i2c_err: 0 });

  return { next, health, input, options, get lines() { return lines; }, get v() { return v; } };
}

// Tarayıcı sürücüsü. Satır sayısı geçen süreden hesaplanır, böylece setInterval
// düzensiz uyansa da ortalama 200 satır/sn korunur. Saat ve zamanlayıcı enjekte
// edilebilir (test için).
export function createSimulator({
  onLine,
  now = () => performance.now(),
  schedule = (fn) => setInterval(fn, SAMPLE_PERIOD_MS),
  cancel = (id) => clearInterval(id),
  keyTarget = globalThis.window,
  engine = createSimEngine(),
  maxBurst = 40,
} = {}) {
  let timer = null;
  let t0 = 0;
  let emitted = 0;
  const held = new Set();

  function tick() {
    const t = now();
    let due = Math.floor((t - t0) / SAMPLE_PERIOD_MS) - emitted;
    if (due > maxBurst) { // sekme arka plandaydı: yığmak yerine yeniden eşitle
      emitted += due - maxBurst;
      due = maxBurst;
    }
    for (let i = 0; i < due; i++) {
      onLine(engine.next(), t);
      emitted += 1;
      if (engine.lines % 200 === 0) onLine(engine.health(), t);
    }
  }

  function applyKeys() {
    engine.input.mask = Object.entries(KEY_STRING)
      .reduce((m, [code, s]) => (held.has(code) ? m | (1 << s) : m), 0);
    const right = held.has('ArrowRight');
    const left = held.has('ArrowLeft');
    engine.input.dir = right === left ? 0 : right ? 1 : -1;
    engine.input.fast = held.has('ShiftLeft') || held.has('ShiftRight');
    engine.input.fingers = Object.entries(KEY_FINGER).filter(([code]) => held.has(code)).map(([, f]) => f);
  }

  // Yazı alanı, sayı kutusu ya da kaydırıcı odaktaysa tuşlar onlarındır.
  // Checkbox ve düğme odakta kalsa da simülatör çalışır.
  const KEYBOARD_INPUTS = ['text', 'number', 'search', 'range'];
  const isTyping = (e) => {
    const tag = e.target?.tagName;
    return tag === 'TEXTAREA' || tag === 'SELECT'
      || (tag === 'INPUT' && KEYBOARD_INPUTS.includes(e.target.type));
  };
  const handled = (code) => code in KEY_STRING || code in KEY_FINGER || code.startsWith('Arrow') || code.startsWith('Shift');

  function onKeyDown(e) {
    if (isTyping(e) || !handled(e.code)) return;
    e.preventDefault(); // ok tuşları sayfayı kaydırmasın
    held.add(e.code);
    applyKeys();
  }
  function onKeyUp(e) {
    if (!handled(e.code)) return;
    held.delete(e.code);
    applyKeys();
  }
  function onBlur() {
    held.clear();
    applyKeys();
  }

  return {
    engine,
    start() {
      if (timer !== null) return;
      t0 = now();
      emitted = 0;
      keyTarget?.addEventListener('keydown', onKeyDown);
      keyTarget?.addEventListener('keyup', onKeyUp);
      keyTarget?.addEventListener('blur', onBlur);
      timer = schedule(tick);
    },
    stop() {
      if (timer === null) return;
      cancel(timer);
      timer = null;
      keyTarget?.removeEventListener('keydown', onKeyDown);
      keyTarget?.removeEventListener('keyup', onKeyUp);
      keyTarget?.removeEventListener('blur', onBlur);
      onBlur();
    },
    get running() { return timer !== null; },
    tick, // test için
  };
}
