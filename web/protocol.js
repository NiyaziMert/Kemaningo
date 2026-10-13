// S ve H satırlarının ayrıştırılması (Mesaj 1 → Mesaj 2). Saf modül.
//   S,t_us,mask,ax,ay,az,gx,gy,gz,fmask   saniyede 200 kez
//   H,t_us,fw,imu_ok,i2c_err              saniyede bir
// fmask (0–15): 5 ms'lik pencerede LOW görülen parmak şeritleri (bit 0 = 1. parmak). Şerit,
// yalnızca sopanın değdiği bakır tel ona bastırılınca LOW olur.
// Eski biçimler de okunur: 9 alanlı S (şeritsiz, fmask = null) ve 13 alanlı S (kapasitif
// şerit denemesi, t1–t4 ham değerleri; fmask = null); 6 alanlı H (touch_us).

export const ACC_LSB_PER_G = 8192;     // ±4 g aralığı
export const GYRO_LSB_PER_DPS = 65.5;  // ±500 °/s aralığı
export const G = 9.80665;              // m/s²
export const SAMPLE_PERIOD_MS = 5;

const U32 = 2 ** 32;
const INT_RE = /^-?\d+$/;
const isInt16 = (v) => v >= -32768 && v <= 32767;

// Tek satırı alanlarına ayırır; biçim bozuksa null.
export function parseLine(line) {
  const f = line.trim().split(',');
  if (f[0] === 'S') {
    if (![9, 10, 13].includes(f.length) || !f.slice(1).every((x) => INT_RE.test(x))) return null;
    const n = f.slice(1).map(Number);
    const [t_us, mask] = n;
    const raw = n.slice(2, 8);
    const fmask = f.length === 10 ? n[8] : null;
    const touch = f.length === 13 ? n.slice(8, 12) : null;
    if (t_us < 0 || t_us >= U32 || mask < 0 || mask > 15 || !raw.every(isInt16)) return null;
    if (fmask !== null && (fmask < 0 || fmask > 15)) return null;
    if (touch && !touch.every((v) => v >= 0 && v < U32)) return null;
    return { type: 'S', t_us, mask, raw, fmask, touch };
  }
  if (f[0] === 'H') {
    if ((f.length !== 5 && f.length !== 6) || !INT_RE.test(f[1]) || !f[2] || !INT_RE.test(f[4])) return null;
    if (f[3] !== '0' && f[3] !== '1') return null;
    if (f.length === 6 && !INT_RE.test(f[5])) return null;
    const t_us = Number(f[1]);
    const i2c_err = Number(f[4]);
    const touch_us = f.length === 6 ? Number(f[5]) : null;
    if (t_us < 0 || t_us >= U32 || i2c_err < 0 || touch_us < 0) return null;
    return { type: 'H', t_us, fw: f[2], imu_ok: f[3] === '1', i2c_err, touch_us };
  }
  return { type: 'other' };
}

export function formatS({ t_us, mask, raw, fmask = null }) {
  return `S,${t_us >>> 0},${mask},${raw.join(',')}${fmask === null ? '' : `,${fmask}`}`;
}

export function formatH({ t_us, fw, imu_ok, i2c_err, touch_us = null }) {
  return `H,${t_us >>> 0},${fw},${imu_ok ? 1 : 0},${i2c_err}${touch_us === null ? '' : `,${touch_us}`}`;
}

// Satır akışını örnek nesnelerine çevirir. t_us 32 bitte ~71 dakikada başa döner;
// ardışık fark (t - prev) mod 2^32 alınarak kesintisiz bir ms saati tutulur.
export function createParser({ onSample = () => {}, onHealth = () => {} } = {}) {
  const stats = { s: 0, h: 0, bad: 0, other: 0 };
  let prevUs = null;
  let tMs = 0;

  function advance(t_us) {
    if (prevUs !== null) tMs += ((t_us - prevUs + U32) % U32) / 1000;
    prevUs = t_us;
    return tMs;
  }

  function push(line, t_host) {
    if (line.trim() === '') return;
    const p = parseLine(line);
    if (p === null) { stats.bad += 1; return; }
    if (p.type === 'other') { stats.other += 1; return; }
    const t = advance(p.t_us);
    if (p.type === 'H') {
      stats.h += 1;
      onHealth({ t, t_host, fw: p.fw, imu_ok: p.imu_ok, i2c_err: p.i2c_err, touch_us: p.touch_us });
      return;
    }
    stats.s += 1;
    const [ax, ay, az, gx, gy, gz] = p.raw;
    const acc = (v) => (v / ACC_LSB_PER_G) * G;
    const gyro = (v) => (v / GYRO_LSB_PER_DPS) * (Math.PI / 180);
    onSample({
      t, t_host, mask: p.mask,
      acc: [acc(ax), acc(ay), acc(az)],
      gyro: [gyro(gx), gyro(gy), gyro(gz)], // sapma motion.js'de çıkarılır
      fmask: p.fmask,                        // LOW görülen parmak şeritleri ya da null
      finger: 0,                             // fingers.js doldurur (0 = boş tel)
      v: null, still: null,                  // motion.js doldurur
    });
  }

  return { push, stats };
}

// Son windowMs içindeki satır sayısından saniyedeki satır hızı.
export function createRateMeter(windowMs = 1000) {
  const times = [];
  return {
    push(t) { times.push(t); },
    rate(now) {
      while (times.length && times[0] <= now - windowMs) times.shift();
      return (times.length * 1000) / windowMs;
    },
  };
}
