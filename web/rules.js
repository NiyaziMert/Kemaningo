// Hata kuralları, bulguların toplanması ve Türkçe olgu cümleleri. Saf modül;
// yalnızca session.js'in nota kayıtlarını (Mesaj 4) okur.
//
// Her kuralın bir "değerlendirilmez" koşulu vardır: ölçüm güvenilir değilse kural susar.

import * as T from './thresholds.js';
import { STRING_NAMES } from './song.js';

// Odak seçiminde eşitlik sırası da budur.
export const TYPES = ['wrong_string', 'wrong_bow_dir', 'neighbor_touch', 'late', 'early', 'uneven_speed'];

export const TYPE_LABELS = {
  wrong_string: 'yanlış tel',
  neighbor_touch: 'komşu tel',
  early: 'erken',
  late: 'geç',
  wrong_bow_dir: 'ters yay',
  uneven_speed: 'düzensiz hız',
};

const BOW_WORD = { D: 'çekerek', U: 'iterek' };

// Sayıdan sonra gelen iyelik eki: 4'ü, 2'si, 6'sı, 10'u … (son okunan kelimeye göre).
const POSS_UNITS = ['', "'i", "'si", "'ü", "'ü", "'i", "'sı", "'si", "'i", "'u"];
const POSS_TENS = ['', "'u", "'si", "'u", "'ı", "'si", "'ı", "'i", "'i", "'ı"];
export function possessive(n) {
  if (n % 100 === 0) return n === 0 ? `${n}'ı` : `${n}'ü`;
  if (n % 10 !== 0) return `${n}${POSS_UNITS[n % 10]}`;
  return `${n}${POSS_TENS[(n / 10) % 10]}`;
}

// Bir notanın kuralları. rec: nota kaydı; prev: önceki kayıt; beatMs: vuruş süresi.
export function checkNote(rec, prev, { beatMs, useImu = T.USE_IMU, dirCalibrated = true }) {
  const errors = [];
  const notEvaluated = [];

  if (rec.wrong_strokes.length) errors.push('wrong_string');
  if (rec.onset_ms === null) { // nota çalınmadı (deneme yarıda kesildi)
    return { errors, notEvaluated: ['timing', 'bow_dir', 'bow_speed'], played: false };
  }
  if (rec.neighbor_ms >= T.T_TOUCH_MS) errors.push('neighbor_touch');

  // Erken / geç
  const intervalMs = prev
    ? (rec.expected.start_beat - prev.expected.start_beat) * beatMs
    : beatMs; // ilk notada aralık yerine bir vuruş
  const tol = Math.max(T.TIMING_TOL_MS, T.TIMING_TOL_RATIO * intervalMs);
  const e = rec.timing_error_ms;
  if (e === null) notEvaluated.push('timing');             // araya yanlış tel girdi
  else if (e < -tol) errors.push('early');
  else if (e > 2 * beatMs) notEvaluated.push('timing');    // ara verilmiş sayılır
  else if (e > tol) errors.push('late');

  // Ters yay yönü
  if (!useImu || !dirCalibrated || rec.bow_dir === null || rec.dir_conf < T.DIR_CONF_MIN) {
    notEvaluated.push('bow_dir');
  } else if (rec.bow_dir !== rec.expected.bow) {
    errors.push('wrong_bow_dir');
  }

  // Düzensiz yay hızı
  if (!useImu || rec.accel_rms === null || rec.dur_ms < 400) notEvaluated.push('bow_speed');
  else if (rec.accel_rms > T.ACCEL_RMS_MAX) errors.push('uneven_speed');

  return { errors, notEvaluated, played: true, tol };
}

const list = (notes) => notes.join(', ');
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function changeClause(k, n) {
  if (k === 0) return '';
  if (k === n) return n === 1 ? ' Tel değiştirdiğin bir notaydı.' : ' Hepsi tel değiştirdiğin notalar.';
  return ` Bunların ${possessive(k)} tel değiştirdiğin notalar.`;
}

// Bir türün bütün notalarından tek bulgu.
function buildFinding(type, recs, changed) {
  const notes = recs.map((r) => r.index);
  const n = notes.length;
  const at = recs.filter((r) => changed.has(r.index)).length;
  const head = `${n} notada (${list(notes)})`;
  const f = { type, count: n, notes, at_string_change: at };

  switch (type) {
    case 'wrong_string': {
      const parts = recs.map((r) => {
        const got = [...new Set(r.wrong_strokes.map((w) => STRING_NAMES[w.string]))].join('/');
        return `${r.index}. notada ${STRING_NAMES[r.expected.string]} yerine ${got}`;
      });
      f.fact = `${n} notada yanlış tele çektin: ${parts.join(', ')}.`;
      break;
    }
    case 'neighbor_touch': {
      f.avg_ms = Math.round(mean(recs.map((r) => r.neighbor_ms)));
      const played = new Set(recs.map((r) => r.expected.string));
      const touched = new Set(recs.map((r) => r.neighbor_string));
      const what = played.size === 1 && touched.size === 1
        ? `${STRING_NAMES[[...played][0]]} telini çalarken ${STRING_NAMES[[...touched][0]]} teline de değdin`
        : 'çaldığın telin komşusuna da değdin';
      f.fact = `${head} ${what}; ortalama ${f.avg_ms} ms.${changeClause(at, n)}`;
      break;
    }
    case 'early':
    case 'late': {
      f.avg_ms = Math.round(mean(recs.map((r) => Math.abs(r.timing_error_ms))));
      f.fact = `${head} ${type === 'late' ? 'geç' : 'erken'} girdin; ortalama ${f.avg_ms} ms.${changeClause(at, n)}`;
      break;
    }
    case 'wrong_bow_dir': {
      // Art arda 3+ ters yön: "şu notadan itibaren yön kaydı".
      let run = 1;
      let best = { len: 1, from: notes[0] };
      for (let i = 1; i < recs.length; i++) {
        run = recs[i].index === recs[i - 1].index + 1 ? run + 1 : 1;
        if (run > best.len) best = { len: run, from: recs[i - run + 1].index };
      }
      if (best.len >= 3) {
        f.shift_from = best.from;
        f.fact = `${best.from}. notadan itibaren yay yönün kaydı: ${best.len} nota boyunca çekerek yerine iterek, `
          + `iterek yerine çekerek çaldın.${n > best.len ? ` Toplam ${n} notada (${list(notes)}) yön tersti.` : ''}`;
      } else {
        const r = recs[0];
        f.fact = n === 1
          ? `1 notada (${r.index}) ${BOW_WORD[r.expected.bow]} yerine ${BOW_WORD[r.bow_dir]} çaldın.`
          : `${head} yay yönün tersti.`;
      }
      break;
    }
    case 'uneven_speed': {
      f.avg = Math.round(mean(recs.map((r) => r.accel_rms)) * 100) / 100;
      f.fact = `${head} yay hızın düzensizdi.`;
      break;
    }
    default:
      throw new Error(`bilinmeyen tür ${type}`);
  }
  return f;
}

// Bütün denemenin değerlendirmesi.
export function evaluate(records, { bpm, useImu = T.USE_IMU, dirCalibrated = true }) {
  const beatMs = 60000 / bpm;
  const perNote = records.map((rec, i) => ({
    index: rec.index, ...checkNote(rec, records[i - 1], { beatMs, useImu, dirCalibrated }),
  }));
  const changed = new Set(records
    .filter((r, i) => i > 0 && r.expected.string !== records[i - 1].expected.string)
    .map((r) => r.index));

  const counts = Object.fromEntries(TYPES.map((t) => [t, 0]));
  const notEvaluated = { timing: 0, bow_dir: 0, bow_speed: 0 };
  let clean = 0;
  let withError = 0;
  for (const p of perNote) {
    for (const t of p.errors) counts[t] += 1;
    if (!p.played) continue;
    for (const k of p.notEvaluated) notEvaluated[k] += 1;
    if (p.errors.length) withError += 1; else clean += 1;
  }

  const findings = TYPES
    .filter((t) => counts[t] > 0)
    .map((t) => buildFinding(t, records.filter((_, i) => perNote[i].errors.includes(t)), changed))
    // En çok notayı etkileyen önce; eşitlikte TYPES sırası (sort kararlıdır).
    .sort((a, b) => b.count - a.count)
    .map((f, i) => ({ id: `F${i + 1}`, ...f }));

  return {
    perNote,
    summary: {
      notes_clean: clean,
      notes_with_error: withError,
      notes_played: clean + withError,
      counts,
      not_evaluated: notEvaluated,
    },
    findings,
  };
}
