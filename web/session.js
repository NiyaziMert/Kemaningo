// Oturum: sıradaki nota, doğru telde ses, nota kayıtları (Mesaj 4). Saf modül;
// ses nesnesi dışarıdan verilir: { noteOn(midi), setLevel(0–1), noteOff() }.
//
// Akış: stroke_start doğru teldeyse ses hemen başlar. stroke_confirm ile şarkı
// ilerler. stroke_end'de notanın kaydı tamamlanır. Yanlış telde ses yok, ilerleme
// yok; kesinleşen yanlış çekiş o notanın wrong_strokes listesine girer.

import * as T from './thresholds.js';
import { speedToLevel, LEVEL_CONTACT_ONLY } from './audio.js';

const NEIGHBOR_LOOKBACK_MS = T.T_GAP_MS; // girişten önceki 80 ms

// Erken/geç: aralık hatası ile ızgara hatasından mutlak değeri küçük olan (rules tablosu).
export function timingErrors(rec, prev, beatMs) {
  const grid = rec.onset_ms - rec.expected.start_beat * beatMs;
  const interval = prev && prev.onset_ms !== null
    ? rec.onset_ms - prev.onset_ms - (rec.expected.start_beat - prev.expected.start_beat) * beatMs
    : null;
  const best = interval === null || Math.abs(grid) <= Math.abs(interval) ? grid : interval;
  return { grid_error_ms: grid, interval_error_ms: interval, timing_error_ms: best };
}

export function createSession({
  song, audio, useImu = T.USE_IMU,
  onChange = () => {}, onEnd = () => {},
}) {
  const beatMs = 60000 / song.bpm;
  const records = song.notes.filter((n) => !n.rest).map((n) => ({
    index: n.index,
    expected: { string: n.string, bow: n.bow, midi: n.midi, start_beat: n.start_beat, dur_beats: n.dur_beats },
    onset_ms: null,
    timing_error_ms: null,
    grid_error_ms: null,
    interval_error_ms: null,
    wrong_strokes: [],
    neighbor_ms: 0,
    neighbor_string: null,
    bow_dir: null,
    dir_conf: 0,
    dur_ms: null,
    accel_rms: null,
    gap_count: 0,
    max_gap_ms: 0,
  }));

  let state = 'idle';     // idle → playing → done
  let t0 = null;          // ızgaranın sıfırı (host ms): hazırlık sayımının bittiği an
  let pointer = 0;        // beklenen kaydın indeksi
  let active = null;      // { id, rec, ok, confirmed, t_host }: ok = doğru tel
  const recentCancels = []; // { string, t_end, dur_ms }: iptal edilen dokunuşlar

  const current = () => records[pointer] ?? null;

  function finish() {
    state = 'done';
    audio.noteOff();
    onChange();
    onEnd(records);
  }

  function onStart(e) {
    const rec = current();
    if (!rec) return;
    const ok = e.string === rec.expected.string;
    active = { id: e.id, rec, ok, confirmed: false, t_host: e.t_host, string: e.string };
    if (ok) {
      audio.setLevel(useImu ? speedToLevel(0) : LEVEL_CONTACT_ONLY);
      audio.noteOn(rec.expected.midi);
    }
    onChange();
  }

  function onConfirm(e) {
    if (!active || active.id !== e.id) return;
    active.confirmed = true;
    if (active.ok) {
      active.rec.onset_ms = active.t_host - t0;
      pointer += 1; // şarkı ilerler; kayıt stroke_end'de tamamlanır
    }
    onChange();
  }

  function onEnd_(e) {
    if (!active || active.id !== e.id) return;
    const a = active;
    active = null;
    if (!a.ok) {
      if (a.confirmed) a.rec.wrong_strokes.push({ string: a.string, dur_ms: e.dur_ms });
      else recentCancels.push({ string: a.string, t_end: e.t_host, dur_ms: e.dur_ms });
      onChange();
      return;
    }
    audio.noteOff();
    if (!a.confirmed) { // 100 ms dolmadı: ses kesildi, şarkı ilerlemedi
      onChange();
      return;
    }
    const rec = a.rec;
    // Komşu tele değme: çekiş sırasında + girişten önceki 80 ms'de iptal edilen dokunuşlar.
    const s = rec.expected.string;
    const neighbor = [0, 0, 0, 0];
    for (const j of [s - 1, s + 1]) if (j >= 0 && j <= 3) neighbor[j] += e.other_ms[j];
    for (const c of recentCancels) {
      if (Math.abs(c.string - s) === 1 && a.t_host - c.t_end <= NEIGHBOR_LOOKBACK_MS && c.t_end <= a.t_host + 1) {
        neighbor[c.string] += c.dur_ms;
      }
    }
    recentCancels.length = 0;
    rec.neighbor_ms = neighbor.reduce((x, y) => x + y, 0);
    rec.neighbor_string = rec.neighbor_ms > 0 ? neighbor.indexOf(Math.max(...neighbor)) : null;
    rec.bow_dir = useImu ? e.dir : null;
    rec.dir_conf = useImu ? e.dir_conf : 0;
    rec.dur_ms = e.dur_ms;
    rec.accel_rms = e.accel_rms;
    rec.gap_count = e.gap_count;
    rec.max_gap_ms = e.max_gap_ms;

    const i = records.indexOf(rec);
    const t = timingErrors(rec, records[i - 1], beatMs);
    rec.grid_error_ms = t.grid_error_ms;
    rec.interval_error_ms = t.interval_error_ms;
    // Yanlış tel, aynı notanın zamanlamasını değerlendirme dışı bırakır.
    rec.timing_error_ms = rec.wrong_strokes.length ? null : t.timing_error_ms;

    if (pointer >= records.length) finish(); // son notanın çekişi bitti
    else onChange();
  }

  return {
    start(gridZeroHost) {
      t0 = gridZeroHost;
      state = 'playing';
      onChange();
    },
    stop() {
      if (state === 'playing') finish();
    },
    handle(e) {
      if (state !== 'playing') return;
      if (e.type === 'stroke_start') onStart(e);
      else if (e.type === 'stroke_confirm') onConfirm(e);
      else if (e.type === 'stroke_end') onEnd_(e);
      else if (e.type === 'stroke_update' && active?.ok && active.id === e.id && useImu) {
        audio.setLevel(speedToLevel(e.speed));
      }
    },
    getExpected: () => (state === 'playing' ? current()?.expected.string ?? null : null),
    get state() { return state; },
    get pointer() { return pointer; },
    get records() { return records; },
    get sounding() { return active?.ok ?? false; },
    get beatMs() { return beatMs; },
    get t0() { return t0; },
  };
}
