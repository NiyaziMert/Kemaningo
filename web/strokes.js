// Yay bölütleme (Karar 2): temas ve hızdan çekiş olayları. Saf modül.
//
// Olaylar:
//   stroke_start   { id, t, t_host, string, cause }
//   stroke_update  { id, t, speed }                 her örnekte
//   stroke_confirm { id, t, t_host }                çekiş kesinleşti (plana ek)
//   stroke_end     { id, t, t_host, string, cause, dur_ms, confirmed, dir, dir_conf,
//                    accel_rms, gap_count, max_gap_ms, other_ms }
//
// Kesinleşme ölçütü plandaki gibi 100 ms'dir. Ama durağanlık ancak 60 ms'lik
// pencere dolunca görüldüğü için IMU kipinde stroke_confirm en erken 160 ms'de
// yayınlanır. Ses stroke_start ile hemen başlar; gecikme yalnızca ilerlemededir.

import * as T from './thresholds.js';
import { SAMPLE_PERIOD_MS as DT } from './protocol.js';

const HISTORY_MS = 500;
const bitIndex = (mask) => 31 - Math.clz32(mask);
const isSingleBit = (mask) => mask !== 0 && (mask & (mask - 1)) === 0;

export function createStrokeSegmenter({
  onEvent = () => {},
  useImu = T.USE_IMU,
  getExpected = () => null, // session.js: beklenen tel (0–3) ya da null
} = {}) {
  let nextId = 1;
  const history = [];                       // son 500 ms: { t, t_host, mask, v, a_ax }
  const contactSince = [null, null, null, null];

  // Yön durumu: temas yokken de güncellenir (havadaki hareket).
  let dir = 0;      // +1 çekerek, -1 iterek, 0 bilinmiyor
  let peak = 0;     // o yöndeki en büyük |v|
  let prevV = 0;
  let zeroT = null; // v'nin son işaret değiştirdiği an

  let alone = null; // { string, since }: tel devri adayı
  let stroke = null;

  const emit = (type, data) => onEvent({ type, ...data });

  function hostAt(t) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].t <= t) return history[i].t_host + (t - history[i].t);
    }
    return history.length ? history[0].t_host - (history[0].t - t) : null;
  }

  function begin(string, startT, cause) {
    const samples = history.filter((h) => h.t >= startT);
    let speed = samples.length ? samples[0].v : 0;
    for (let i = 1; i < samples.length; i++) speed += samples[i].a_ax * (DT / 1000);
    stroke = {
      id: nextId++, string, start: startT, curDir: dir, confirmed: false,
      lastContact: startT, gapRun: 0, lastGap: null, samples, speed,
    };
    emit('stroke_start', { id: stroke.id, t: startT, t_host: hostAt(startT), string, cause });
  }

  function confirm(t) {
    stroke.confirmed = true;
    emit('stroke_confirm', { id: stroke.id, t, t_host: hostAt(t) });
  }

  function end(endT, cause, { cancel = false } = {}) {
    const s = stroke;
    stroke = null;
    const dur = Math.max(0, endT - s.start);
    const samples = s.samples.filter((x) => x.t < endT);
    const confirmed = s.confirmed || (!cancel && dur >= T.T_MIN_STROKE_MS);
    if (confirmed && !s.confirmed) {
      emit('stroke_confirm', { id: s.id, t: endT, t_host: hostAt(endT) });
    }
    emit('stroke_end', {
      id: s.id, t: endT, t_host: hostAt(endT), string: s.string, cause, dur_ms: dur, confirmed,
      ...summarize(samples, s.start, endT, s.string, useImu),
    });
  }

  function updateDirection(sample) {
    const { v } = sample;
    let reversalT = null;
    if ((v > 0 && prevV <= 0) || (v < 0 && prevV >= 0)) zeroT = sample.t;
    prevV = v;
    if (sample.still && sample.t - sample.still_since >= T.T_PAUSE_MS) { // durdu: yön unutulur
      dir = 0;
      peak = 0;
    }
    const cand = v >= T.V_MIN ? 1 : v <= -T.V_MIN ? -1 : 0;
    if (cand === 0) return null;
    if (dir === 0) {
      dir = cand;
      peak = Math.abs(v);
    } else if (cand === dir) {
      peak = Math.max(peak, Math.abs(v));
    } else if (Math.abs(v) >= T.REV_RATIO * peak) {
      dir = cand;
      peak = Math.abs(v);
      reversalT = zeroT ?? sample.t;
    }
    return reversalT;
  }

  // Aktif çekişi işler. Çekiş bittiyse ya da yenisi başladıysa true döner.
  function handleActive(sample, reversalT) {
    const s = stroke;
    const { t, mask } = sample;
    const on = (mask & (1 << s.string)) !== 0;

    // 1. Tel devri: başka bir tel T_SWITCH_MS boyunca tek başına temas ediyor.
    if (isSingleBit(mask) && !on) {
      const j = bitIndex(mask);
      if (!alone || alone.string !== j) alone = { string: j, since: t };
    } else {
      alone = null;
    }
    if (alone && t - alone.since + DT >= T.T_SWITCH_MS) {
      const { string, since } = alone;
      alone = null;
      end(since, 'string_change');
      begin(string, since, 'string_change');
      return true;
    }

    // 2. Temas boşlukları
    if (on) {
      if (s.gapRun > 0) {
        s.lastGap = { start: s.lastContact + DT, end: t };
        s.gapRun = 0;
        const young = s.lastGap.start - s.start < T.T_MIN_STROKE_MS;
        if (useImu && s.curDir !== 0 && dir !== 0 && dir !== s.curDir) {
          if (young) {
            s.curDir = dir;
          } else { // boşluk + yön değişimi: yeni çekiş temasın geri geldiği an başlar
            const g = s.lastGap;
            end(g.start, 'reversal');
            begin(s.string, g.end, 'reversal');
            return true;
          }
        }
      }
      s.lastContact = t;
    } else {
      s.gapRun += DT;
      if (s.gapRun >= T.T_GAP_MS) {
        end(s.lastContact + DT, 'gap');
        return true;
      }
    }

    if (!useImu) {
      if (!s.confirmed && s.lastContact + DT - s.start >= T.T_MIN_STROKE_MS) confirm(t);
      return false;
    }

    // 3. Temas sürerken yön değişimi
    if (on && reversalT !== null && s.curDir !== 0 && dir !== s.curDir) {
      if (reversalT - s.start < T.T_MIN_STROKE_MS) {
        s.curDir = dir; // geçici sürede yalnızca yönü belirler
      } else {
        const g = s.lastGap;
        if (g && reversalT >= g.start - T.T_ASSOC_MS && reversalT <= g.end + T.T_ASSOC_MS) {
          end(g.start, 'reversal');
          begin(s.string, g.end, 'reversal');
        } else {
          end(reversalT, 'reversal');
          begin(s.string, reversalT, 'reversal');
        }
        return true;
      }
    } else if (s.curDir === 0 && dir !== 0) {
      s.curDir = dir;
    }

    // 4. Durma: geçici sürede durağanlık iptal eder; sonra T_PAUSE_MS çekişi bitirir.
    if (sample.still) {
      const since = Math.max(s.start, sample.still_since);
      if (!s.confirmed && since < s.start + T.T_MIN_STROKE_MS) {
        end(since, 'pause', { cancel: true });
        return true;
      }
      if (t - sample.still_since >= T.T_PAUSE_MS) {
        end(since, 'pause');
        return true;
      }
    }

    // 5. Kesinleşme
    if (!s.confirmed
      && t - s.start >= T.T_MIN_STROKE_MS + T.STILL_WINDOW_MS
      && s.lastContact + DT - s.start >= T.T_MIN_STROKE_MS) {
      confirm(t);
    }
    return false;
  }

  function maybeStart(sample) {
    const { t, mask } = sample;
    if (mask === 0) return;
    if (useImu && sample.still) return; // sopa telde bekliyor: ses yok
    const expected = getExpected();
    let string;
    if (expected !== null && mask & (1 << expected)) {
      string = expected;
    } else { // en uzun süredir temas eden tel
      string = [0, 1, 2, 3].filter((i) => mask & (1 << i))
        .reduce((a, b) => (contactSince[b] < contactSince[a] ? b : a));
    }
    begin(string, t, contactSince[string] === t ? 'contact' : 'resume');
  }

  function push(sample) {
    const entry = {
      t: sample.t, t_host: sample.t_host, mask: sample.mask,
      v: useImu ? sample.v : 0, a_ax: useImu ? sample.a_ax : 0,
    };
    history.push(entry);
    while (history[0].t < sample.t - HISTORY_MS) history.shift();
    if (stroke) stroke.samples.push(entry);

    for (let i = 0; i < 4; i++) {
      if (sample.mask & (1 << i)) contactSince[i] ??= sample.t;
      else contactSince[i] = null;
    }

    const reversalT = useImu ? updateDirection(sample) : null;
    if (stroke) {
      stroke.speed += entry.a_ax * (DT / 1000);
      handleActive(sample, reversalT);
    }
    if (!stroke) maybeStart(sample);
    if (stroke) emit('stroke_update', { id: stroke.id, t: sample.t, speed: Math.abs(stroke.speed) });
  }

  return { push, get active() { return stroke !== null; } };
}

// stroke_end alanları: yön (ilk 200 ms), accel_rms (orta bölüm), boşluklar, diğer teller.
export function summarize(samples, start, end, string, useImu = true) {
  const other_ms = [0, 0, 0, 0];
  let gap_count = 0;
  let max_gap_ms = 0;
  let run = 0;
  for (const x of samples) {
    for (let j = 0; j < 4; j++) if (j !== string && x.mask & (1 << j)) other_ms[j] += DT;
    if (x.mask & (1 << string)) {
      if (run > 0) { gap_count += 1; max_gap_ms = Math.max(max_gap_ms, run); }
      run = 0;
    } else {
      run += DT;
    }
  }
  if (!useImu) return { dir: null, dir_conf: 0, accel_rms: null, gap_count, max_gap_ms, other_ms };

  // Yön: ilk 200 ms'deki hız işaretlerinin çoğunluğu.
  const head = samples.filter((x) => x.t < start + T.DIR_WINDOW_MS);
  const pos = head.filter((x) => x.v > 0).length;
  const neg = head.filter((x) => x.v < 0).length;
  const sign = pos > neg ? 1 : neg > pos ? -1 : 0;
  const dir = sign === 1 ? 'D' : sign === -1 ? 'U' : null;
  const dir_conf = head.length && sign
    ? head.filter((x) => Math.sign(x.v) === sign && Math.abs(x.v) > T.V_MIN).length / head.length
    : 0;

  // accel_rms: baştan ve sondan 100 ms atılır, 5 örneklik hareketli ortalama,
  // ortalaması çıkarılır, karekök ortalama kare.
  const mid = samples.filter((x) => x.t >= start + T.RMS_TRIM_MS && x.t < end - T.RMS_TRIM_MS)
    .map((x) => x.a_ax);
  let accel_rms = null;
  const M = T.RMS_MA_SAMPLES;
  if (mid.length >= M) {
    const smooth = [];
    for (let i = M - 1; i < mid.length; i++) {
      let sum = 0;
      for (let k = 0; k < M; k++) sum += mid[i - k];
      smooth.push(sum / M);
    }
    const m = smooth.reduce((a, b) => a + b, 0) / smooth.length;
    accel_rms = Math.sqrt(smooth.reduce((a, b) => a + (b - m) ** 2, 0) / smooth.length);
  }
  return { dir, dir_conf, accel_rms, gap_count, max_gap_ms, other_ms };
}
